import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  WardEngine,
  Runechain,
  InMemoryRateLimiter,
  loadBifrostFile,
  createSinks,
  DriftDetector,
} from "@heimdall/core";
import type { ToolCallContext, Rune, HeimdallSink, BifrostConfig, DriftAlert, DriftConfig } from "@heimdall/core";
import { redactSecrets } from "@heimdall/core";
import { WsBridge } from "./ws-bridge.js";

export interface BifrostOptions {
  targetCommand: string;
  targetArgs: string[];
  configPath: string;
  dbPath?: string;
  sessionId?: string;
  agentId?: string;
  wsPort?: number;
  dryRun?: boolean;
  onRune?: (rune: Rune) => void;
}

export async function startBifrost(options: BifrostOptions): Promise<void> {
  const config = await loadBifrostFile(options.configPath);
  const rateLimiter = new InMemoryRateLimiter();
  const wardEngine = new WardEngine(config, {
    rateLimitProvider: rateLimiter.getCallCount,
  });
  const runechain = new Runechain(options.dbPath ?? "heimdall.sqlite");
  const driftDetector = new DriftDetector();
  const driftConfig: DriftConfig | undefined = config.drift;
  const serverId = `${config.realm}:${options.targetCommand}`;
  const sessionId = options.sessionId ?? crypto.randomUUID();
  const agentId = options.agentId ?? "unknown";

  // Start WebSocket bridge for live dashboard updates
  const wsBridge = new WsBridge();
  if (options.wsPort) {
    wsBridge.start(options.wsPort);
  }

  // Create sinks from config
  const sinks: HeimdallSink[] = createSinks(config.sinks ?? []);
  if (sinks.length > 0) {
    console.error(`[HEIMDALL] Sinks: ${sinks.map((s) => s.name).join(", ")}`);
  }

  console.error(`[HEIMDALL] Bifrost proxy starting...`);
  console.error(`[HEIMDALL] Realm: ${config.realm}`);
  console.error(`[HEIMDALL] Wards loaded: ${config.wards.length}`);
  if (driftConfig) {
    console.error(`[HEIMDALL] Drift detection: ${driftConfig.action}`);
  }
  console.error(`[HEIMDALL] Target: ${options.targetCommand} ${options.targetArgs.join(" ")}`);
  console.error(`[HEIMDALL] Session: ${sessionId}`);

  // Connect to the real MCP server as a client
  const clientTransport = new StdioClientTransport({
    command: options.targetCommand,
    args: options.targetArgs,
  });
  const mcpClient = new Client(
    { name: "heimdall-bifrost", version: "0.1.0" },
    { capabilities: {} }
  );
  await mcpClient.connect(clientTransport);
  console.error(`[HEIMDALL] Connected to target MCP server`);

  // Create the proxy MCP server (facing the agent)
  const proxyServer = new Server(
    { name: "heimdall-bifrost", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // Proxy tools/list: pass through + drift detection
  proxyServer.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await mcpClient.listTools();
    const tools = result.tools;

    // Drift detection
    if (driftConfig) {
      const currentHash = driftDetector.canonicalHash(tools);
      const baseline = runechain.getBaseline(serverId);

      if (!baseline) {
        // First time: establish baseline
        runechain.setBaseline(
          serverId,
          currentHash,
          JSON.stringify(tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })))
        );
        console.error(
          `[HEIMDALL] Drift: baseline established for ${serverId} (${tools.length} tools, hash: ${currentHash.slice(0, 12)}...)`
        );
      } else if (baseline.tools_hash !== currentHash) {
        // Drift detected!
        const baselineTools = JSON.parse(baseline.tools_snapshot);
        const changes = driftDetector.diff(baselineTools, tools);

        const alert: DriftAlert = {
          server_id: serverId,
          timestamp: new Date().toISOString(),
          changes,
          previous_hash: baseline.tools_hash,
          current_hash: currentHash,
          action_taken: driftConfig.action,
        };

        console.error(
          `[HEIMDALL] DRIFT DETECTED: ${changes.length} change(s) in ${serverId}`
        );
        for (const c of changes) {
          console.error(`  [${c.severity.toUpperCase()}] ${c.type}: ${c.tool_name} — ${c.details}`);
        }

        wsBridge.broadcastDrift(alert);

        // Store as pending baseline — requires explicit approval via `heimdall baseline approve`
        const toolsSnapshot = JSON.stringify(tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })));
        runechain.setPendingBaseline(serverId, currentHash, toolsSnapshot);

        if (driftConfig.action === "HALT") {
          throw new Error(
            `[HEIMDALL] Drift detected: ${driftConfig.message ?? "Server tool definitions changed"}. Run \`heimdall baseline approve\` to accept.`
          );
        }

        // For WARN/LOG: drift keeps being detected until user explicitly approves
      }
    }

    return { tools };
  });

  // Intercept tools/call — THE CORE
  proxyServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const toolArgs = (request.params.arguments ?? {}) as Record<string, unknown>;

    const ctx: ToolCallContext = {
      tool_name: toolName,
      arguments: toolArgs,
      session_id: sessionId,
      agent_id: agentId,
      server_id: options.targetCommand,
    };

    // Record call before evaluation so current call counts toward rate limit
    rateLimiter.call(sessionId, toolName);
    const evaluation = wardEngine.evaluate(ctx);

    // Compute risk score (pure function, no latency)
    let riskScore: number | undefined;
    let riskTier: string | undefined;
    let aiReasoning: string | undefined;

    try {
      if (config.ai_analysis?.enabled) {
        const { computeRiskScore, analyzeWithThinking } = await import("@heimdall/ai");

        // Compute arguments hash for AI analysis (same algo as runechain)
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(toolArgs)));
        const argsHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

        const safeArgsSummary = redactSecrets(JSON.stringify(toolArgs)).slice(0, 200);

        const riskResult = computeRiskScore({
          tool_name: toolName,
          arguments_hash: argsHash,
          arguments_summary: safeArgsSummary,
          decision: evaluation.decision,
          matched_wards: evaluation.matched_wards,
          rationale: evaluation.rationale,
        });
        riskScore = riskResult.score;
        riskTier = riskResult.tier;

        // Only call AI for HIGH/CRITICAL tiers
        const threshold = config.ai_analysis.threshold ?? 50;
        if (riskResult.score >= threshold && process.env.ANTHROPIC_API_KEY) {
          const budgetTokens = config.ai_analysis.budget_tokens ?? 4096;
          try {
            const analysis = await analyzeWithThinking(
              {
                tool_name: toolName,
                arguments_hash: argsHash,
                arguments_summary: safeArgsSummary,
                decision: evaluation.decision,
                matched_wards: evaluation.matched_wards,
                rationale: evaluation.rationale,
              },
              budgetTokens
            );
            // Store only the recommendation summary, not the full thinking chain
            aiReasoning = analysis.recommendation;
            console.error(
              `[HEIMDALL] AI Analysis (${riskTier}, ${analysis.thinking_tokens_used} thinking tokens): ${analysis.recommendation.slice(0, 100)}`
            );
          } catch (err) {
            console.error(`[HEIMDALL] AI analysis failed (non-fatal): ${err}`);
          }
        }
      }
    } catch {
      // AI analysis is non-fatal — risk scoring silently skipped
    }

    if (evaluation.decision === "HALT") {
      if (options.dryRun) {
        console.error(`[HEIMDALL] DRY-RUN HALT: ${toolName} — ${evaluation.rationale} (would block, allowing)`);
        // Fall through to forward the call — rune will be inscribed after execution
      } else {
        // Real HALT: inscribe, emit, return error
        const rune = await runechain.inscribeRune(ctx, evaluation);
        if (riskScore !== undefined) {
          rune.risk_score = riskScore;
          rune.risk_tier = riskTier;
          rune.ai_reasoning = aiReasoning;
        }
        wsBridge.broadcast(rune);
        options.onRune?.(rune);
        await Promise.allSettled(sinks.map((s) => s.emit(rune)));

        console.error(
          `[HEIMDALL] HALT: ${toolName} — ${evaluation.rationale}`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: `[HEIMDALL] Tool call blocked: ${evaluation.rationale}`,
            },
          ],
          isError: true,
        };
      }
    }

    // For RESHAPE, use modified arguments
    const effectiveArgs =
      evaluation.decision === "RESHAPE" && evaluation.reshaped_arguments
        ? evaluation.reshaped_arguments
        : toolArgs;

    if (evaluation.decision === "RESHAPE") {
      console.error(
        `[HEIMDALL] RESHAPE: ${toolName} — ${evaluation.rationale}`
      );
    }

    // Forward to real server
    const startTime = performance.now();
    let toolResponse: unknown;
    let callResult: { content: Array<{ type: string; text: string }>; isError?: boolean };

    try {
      callResult = (await mcpClient.callTool({
        name: toolName,
        arguments: effectiveArgs,
      })) as typeof callResult;
      toolResponse = callResult;
    } catch (error) {
      toolResponse = { error: String(error) };
      callResult = {
        content: [{ type: "text", text: `Tool error: ${error}` }],
        isError: true,
      };
    }

    const duration = Math.round(performance.now() - startTime);

    // Summarize response for audit (redact secrets from tool output)
    const responseSummary = redactSecrets(
      JSON.stringify(callResult.content ?? callResult)
    ).slice(0, 200);

    // Inscribe the rune
    const rune = await runechain.inscribeRune(
      ctx,
      evaluation,
      responseSummary,
      duration
    );
    if (riskScore !== undefined) {
      rune.risk_score = riskScore;
      rune.risk_tier = riskTier;
      rune.ai_reasoning = aiReasoning;
    }
    wsBridge.broadcast(rune);
    options.onRune?.(rune);
    await Promise.allSettled(sinks.map((s) => s.emit(rune)));

    const decisionIcon = evaluation.decision === "PASS" ? "PASS" : evaluation.decision;
    console.error(
      `[HEIMDALL] ${decisionIcon}: ${toolName} (${duration}ms)`
    );

    return callResult;
  });

  // Connect proxy server to agent via stdio
  const serverTransport = new StdioServerTransport();
  await proxyServer.connect(serverTransport);
  console.error(`[HEIMDALL] Bifrost proxy ready. Guarding the bridge.`);

  // Graceful shutdown
  const shutdown = async () => {
    console.error(`[HEIMDALL] Shutting down...`);
    await Promise.allSettled(sinks.filter((s) => s.flush).map((s) => s.flush!()));
    await Promise.allSettled(sinks.filter((s) => s.close).map((s) => s.close!()));
    wsBridge.stop();
    runechain.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

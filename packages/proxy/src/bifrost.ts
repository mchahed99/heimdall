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
    let riskFactors: string[] = [];
    let analyzeOptions: { tool_name: string; arguments_hash: string; arguments_summary: string; decision: string; matched_wards: string[]; rationale: string } | undefined;
    let shouldAnalyze = false;
    let budgetTokens = 4096;

    try {
      if (config.ai_analysis?.enabled) {
        const { computeRiskScore } = await import("@heimdall/ai");

        // Compute arguments hash for risk scoring
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
        riskFactors = riskResult.factors;

        // Check if async AI analysis should be fired
        const threshold = config.ai_analysis.threshold ?? 50;
        budgetTokens = config.ai_analysis.budget_tokens ?? 4096;
        if (riskResult.score >= threshold && process.env.ANTHROPIC_API_KEY) {
          shouldAnalyze = true;
          analyzeOptions = {
            tool_name: toolName,
            arguments_hash: argsHash,
            arguments_summary: safeArgsSummary,
            decision: evaluation.decision,
            matched_wards: evaluation.matched_wards,
            rationale: evaluation.rationale,
          };
        }
      }
    } catch (err) {
      console.error(`[HEIMDALL] Risk scoring failed (non-fatal): ${err}`);
    }

    // Helper: commit AI reasoning to SQLite + push to dashboard
    const commitReasoning = (runeSequence: number, reasoning: string) => {
      runechain.updateRuneRiskFields(runeSequence, riskScore!, riskTier!, reasoning);
      wsBridge.broadcastRuneUpdate({ sequence: runeSequence, ai_reasoning: reasoning });
    };

    // Generate local analysis from risk factors (deterministic, instant fallback)
    const generateLocalAnalysis = (): string => {
      const parts: string[] = [];
      if (riskFactors.some((f) => f.includes("high-risk"))) {
        parts.push(`High-risk tool "${toolName}" invoked`);
      }
      if (evaluation.decision === "HALT") {
        parts.push(`blocked by ward policy — ${evaluation.rationale}`);
      } else if (evaluation.decision === "RESHAPE") {
        parts.push(`payload modified by ward policy — ${evaluation.rationale}`);
      }
      if (riskFactors.some((f) => f.includes("credential"))) {
        parts.push("credential or secret pattern detected in arguments");
      }
      if (riskFactors.some((f) => f.includes("network"))) {
        parts.push("network/exfiltration activity detected");
      }
      if (riskFactors.some((f) => f.includes("destructive"))) {
        parts.push("destructive operation pattern detected");
      }
      if (riskFactors.some((f) => f.includes("PII"))) {
        parts.push("PII pattern detected in payload");
      }
      return `${riskTier} risk (score ${riskScore}/100). ${parts.join("; ")}. ${
        evaluation.matched_wards.length > 0
          ? `Matched wards: ${evaluation.matched_wards.join(", ")}.`
          : ""
      }`;
    };

    // Fire async AI analysis (non-blocking) with local fallback + hard timeout
    const fireAsyncAnalysis = (runeSequence: number) => {
      const local = generateLocalAnalysis();

      if (!shouldAnalyze || !analyzeOptions) {
        if (riskScore !== undefined && riskFactors.length > 0) {
          commitReasoning(runeSequence, local);
          console.error(`[HEIMDALL] Local analysis: ${local.slice(0, 100)}`);
        }
        return;
      }

      // Hard timeout: if Opus doesn't respond in 8s, use local analysis
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("AI analysis timeout (8s)")), 8000)
      );

      import("@heimdall/ai")
        .then(({ analyzeWithThinking }) =>
          Promise.race([analyzeWithThinking(analyzeOptions!, budgetTokens), timeout])
        )
        .then((analysis) => {
          commitReasoning(runeSequence, analysis.recommendation);
          console.error(
            `[HEIMDALL] AI Analysis (${riskTier}, ${analysis.thinking_tokens_used} thinking tokens): ${analysis.recommendation.slice(0, 100)}`
          );
        })
        .catch((err) => {
          console.error(`[HEIMDALL] AI analysis failed, using local: ${err}`);
          commitReasoning(runeSequence, local);
        });
    };

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
          (rune as unknown as Record<string, unknown>).risk_factors = riskFactors;
          runechain.updateRuneRiskFields(rune.sequence, riskScore, riskTier!);
        }
        wsBridge.broadcast(rune);
        options.onRune?.(rune);
        await Promise.allSettled(sinks.map((s) => s.emit(rune)));
        fireAsyncAnalysis(rune.sequence);

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
      (rune as unknown as Record<string, unknown>).risk_factors = riskFactors;
      runechain.updateRuneRiskFields(rune.sequence, riskScore, riskTier!);
    }
    wsBridge.broadcast(rune);
    options.onRune?.(rune);
    await Promise.allSettled(sinks.map((s) => s.emit(rune)));
    fireAsyncAnalysis(rune.sequence);

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

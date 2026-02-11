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
} from "@heimdall/core";
import type { ToolCallContext, Rune, HeimdallSink } from "@heimdall/core";
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

  // Proxy tools/list: pass through from real server
  proxyServer.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await mcpClient.listTools();
    return { tools: result.tools };
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

    // Evaluate wards (rate limit check happens inside)
    const evaluation = wardEngine.evaluate(ctx);
    // Record call for future rate limit checks
    rateLimiter.call(sessionId, toolName);

    if (evaluation.decision === "HALT") {
      // Inscribe blocked call, broadcast, return error
      const rune = await runechain.inscribeRune(ctx, evaluation);
      wsBridge.broadcast(rune);
      options.onRune?.(rune);
      await Promise.allSettled(sinks.map((s) => s.emit(rune)));

      if (options.dryRun) {
        console.error(`[HEIMDALL] DRY-RUN HALT: ${toolName} — ${evaluation.rationale} (would block, allowing)`);
        // Fall through to forward the call
      } else {
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

    // Summarize response for audit
    const responseSummary = JSON.stringify(callResult.content ?? callResult)
      .slice(0, 200);

    // Inscribe the rune
    const rune = await runechain.inscribeRune(
      ctx,
      evaluation,
      responseSummary,
      duration
    );
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

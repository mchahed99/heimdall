import { startBifrost } from "@heimdall/proxy";

export async function guardCommand(options: {
  target: string;
  config: string;
  db: string;
  session?: string;
  agent?: string;
  wsPort: string;
  dryRun?: boolean;
}): Promise<void> {
  // Parse target: "npx -y @mcp/server-filesystem ." → command="npx", args=["-y", ...]
  const parts = options.target.split(/\s+/);
  const [targetCommand, ...targetArgs] = parts;

  if (!targetCommand) {
    console.error("[HEIMDALL] Error: --target must specify a command");
    process.exit(1);
  }

  await startBifrost({
    targetCommand,
    targetArgs,
    configPath: options.config,
    dbPath: options.db,
    sessionId: options.session,
    agentId: options.agent,
    wsPort: parseInt(options.wsPort),
    dryRun: options.dryRun,
  });
}

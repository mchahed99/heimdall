import chalk from "chalk";
import { existsSync } from "fs";

export async function watchtowerCommand(options: {
  port: string;
  db: string;
  wsUpstream?: string;
}): Promise<void> {
  if (!existsSync(options.db)) {
    console.log(chalk.yellow("No audit database found at: " + options.db));
    console.log("Run " + chalk.cyan("heimdall init") + " to get started.");
    return;
  }

  const port = parseInt(options.port);

  // Dynamic import to avoid loading dashboard deps in other commands
  const { startApiServer } = await import("../../src/server/api-server.js");
  const server = await startApiServer(port, options.db);

  // Relay WebSocket messages from upstream (Bifrost WsBridge)
  if (options.wsUpstream) {
    const upstreamUrl = options.wsUpstream;
    const broadcastRaw = (server as unknown as { broadcastRaw: (data: string) => void }).broadcastRaw;

    function connectUpstream() {
      try {
        const ws = new WebSocket(upstreamUrl);

        ws.onmessage = (event) => {
          broadcastRaw(String(event.data));
        };

        ws.onclose = () => {
          // Reconnect after 2s
          setTimeout(connectUpstream, 2000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        setTimeout(connectUpstream, 2000);
      }
    }

    connectUpstream();
    console.log(`  Relaying WebSocket from ${upstreamUrl}`);
  }
}

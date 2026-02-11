import chalk from "chalk";
import { existsSync } from "fs";

export async function watchtowerCommand(options: {
  port: string;
  db: string;
}): Promise<void> {
  if (!existsSync(options.db)) {
    console.log(chalk.yellow("No audit database found at: " + options.db));
    console.log("Run " + chalk.cyan("heimdall init") + " to get started.");
    return;
  }

  const port = parseInt(options.port);

  // Dynamic import to avoid loading dashboard deps in other commands
  const { startApiServer } = await import("../../src/server/api-server.js");
  await startApiServer(port, options.db);
}

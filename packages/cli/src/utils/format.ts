import chalk from "chalk";

export function formatDecision(decision: string): string {
  switch (decision) {
    case "PASS":
      return chalk.green("PASS".padEnd(7));
    case "HALT":
      return chalk.red("HALT".padEnd(7));
    case "RESHAPE":
      return chalk.yellow("RESHAPE");
    default:
      return chalk.dim(decision.padEnd(7));
  }
}

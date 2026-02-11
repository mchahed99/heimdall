import { resolve, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

export interface InstallResult {
  settingsPath: string;
  created: boolean;
  updated: boolean;
}

export function installHooks(projectDir?: string): InstallResult {
  const dir = projectDir ?? process.cwd();
  const claudeDir = resolve(dir, ".claude");
  const settingsPath = resolve(claudeDir, "settings.local.json");

  // Ensure .claude directory exists
  mkdirSync(claudeDir, { recursive: true });

  // Determine hook script paths
  const preToolUse = `bun run ${resolve(dir, "node_modules/@heimdall/hooks/src/pre-tool-use.ts")}`;
  const postToolUse = `bun run ${resolve(dir, "node_modules/@heimdall/hooks/src/post-tool-use.ts")}`;

  const heimdallHooks = {
    hooks: {
      PreToolUse: [
        {
          matcher: ".*",
          hooks: [
            {
              type: "command",
              command: preToolUse,
              timeout: 5000,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: ".*",
          hooks: [
            {
              type: "command",
              command: postToolUse,
              timeout: 3000,
            },
          ],
        },
      ],
    },
  };

  let created = false;
  let updated = false;

  if (existsSync(settingsPath)) {
    // Merge with existing settings
    const existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
    existing.hooks = {
      ...existing.hooks,
      ...heimdallHooks.hooks,
    };
    writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + "\n");
    updated = true;
  } else {
    writeFileSync(
      settingsPath,
      JSON.stringify(heimdallHooks, null, 2) + "\n"
    );
    created = true;
  }

  return { settingsPath, created, updated };
}

export function uninstallHooks(projectDir?: string): boolean {
  const dir = projectDir ?? process.cwd();
  const settingsPath = resolve(dir, ".claude", "settings.local.json");

  if (!existsSync(settingsPath)) return false;

  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  if (settings.hooks) {
    delete settings.hooks.PreToolUse;
    delete settings.hooks.PostToolUse;
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return true;
}

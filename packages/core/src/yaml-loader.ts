import { parse } from "yaml";
import type { BifrostConfig, Ward, SinkConfig, StorageConfig } from "./types.js";

const VALID_ACTIONS = new Set(["PASS", "HALT", "RESHAPE"]);
const VALID_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

/**
 * Replace ${VAR} and ${VAR:-default} patterns with environment variables.
 */
function interpolateEnvVars(content: string): string {
  return content.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const [varName, ...defaultParts] = expr.split(":-");
    const defaultValue = defaultParts.join(":-");
    const envValue = process.env[varName.trim()];
    if (envValue !== undefined) return envValue;
    if (defaultParts.length > 0) return defaultValue;
    throw new Error(
      `bifrost.yaml: required environment variable '${varName.trim()}' is not set. ` +
      `Use \${${varName.trim()}:-default} to provide a default value.`
    );
  });
}

export function loadBifrostConfig(yamlContent: string): BifrostConfig {
  const interpolated = interpolateEnvVars(yamlContent);
  const raw = parse(interpolated);

  if (!raw || typeof raw !== "object") {
    throw new Error("bifrost.yaml: invalid YAML content");
  }
  if (!raw.version) {
    throw new Error("bifrost.yaml: 'version' is required");
  }
  if (!raw.realm) {
    throw new Error("bifrost.yaml: 'realm' is required");
  }

  const wards: Ward[] = (raw.wards ?? []).map((w: Record<string, unknown>, i: number) => {
    if (!w.tool) {
      throw new Error(`bifrost.yaml: ward #${i} is missing 'tool' field`);
    }
    if (!w.action) {
      throw new Error(`bifrost.yaml: ward #${i} is missing 'action' field`);
    }
    if (!VALID_ACTIONS.has(w.action as string)) {
      throw new Error(`bifrost.yaml: ward #${i} has invalid action '${w.action}'. Must be one of: ${[...VALID_ACTIONS].join(", ")}`);
    }
    const severity = (w.severity as string) ?? raw.defaults?.severity ?? "low";
    if (!VALID_SEVERITIES.has(severity)) {
      throw new Error(`bifrost.yaml: ward #${i} has invalid severity '${severity}'. Must be one of: ${[...VALID_SEVERITIES].join(", ")}`);
    }
    return {
      id: (w.id as string) ?? `ward-${i}`,
      description: w.description as string | undefined,
      tool: w.tool as string,
      when: w.when as Ward["when"],
      action: w.action as Ward["action"],
      message: (w.message as string) ?? `Ward '${w.id ?? `ward-${i}`}' triggered`,
      severity: (w.severity as Ward["severity"]) ?? raw.defaults?.severity ?? "low",
      reshape: w.reshape as Record<string, unknown> | undefined,
    };
  });

  const sinks: SinkConfig[] = (raw.sinks ?? []).map((s: Record<string, unknown>) => ({
    ...s,
    type: String(s.type),
    events: s.events as string[] | undefined,
  }));

  const storage: StorageConfig | undefined = raw.storage
    ? { ...raw.storage, adapter: String(raw.storage.adapter) }
    : undefined;

  return {
    version: String(raw.version),
    realm: String(raw.realm),
    description: raw.description as string | undefined,
    wards,
    defaults: {
      action: raw.defaults?.action ?? "PASS",
      severity: raw.defaults?.severity ?? "low",
    },
    sinks,
    storage,
    extends: raw.extends as string[] | undefined,
  };
}

export async function loadBifrostFile(path: string): Promise<BifrostConfig> {
  const { readFileSync } = await import("node:fs");
  const { resolve, dirname } = await import("node:path");

  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`bifrost.yaml not found at: ${path}`);
  }
  const content = await file.text();
  const config = loadBifrostConfig(content);

  // Handle extends — resolve relative to the config file's directory
  if (config.extends && config.extends.length > 0) {
    const baseDir = dirname(resolve(path));
    const extendedWards: Ward[] = [];

    for (const extPath of config.extends) {
      const resolvedPath = resolve(baseDir, extPath);
      const extContent = readFileSync(resolvedPath, "utf-8");
      const extConfig = loadBifrostConfig(extContent);
      extendedWards.push(...extConfig.wards);
    }

    // Extended wards first, then local wards
    config.wards = [...extendedWards, ...config.wards];
  }

  return config;
}

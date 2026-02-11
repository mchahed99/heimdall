import { parse } from "yaml";
import type { BifrostConfig, Ward } from "./types.js";

export function loadBifrostConfig(yamlContent: string): BifrostConfig {
  const raw = parse(yamlContent);

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

  return {
    version: String(raw.version),
    realm: String(raw.realm),
    description: raw.description as string | undefined,
    wards,
    defaults: {
      action: raw.defaults?.action ?? "PASS",
      severity: raw.defaults?.severity ?? "low",
    },
  };
}

export async function loadBifrostFile(path: string): Promise<BifrostConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`bifrost.yaml not found at: ${path}`);
  }
  const content = await file.text();
  return loadBifrostConfig(content);
}

import type { DriftChange } from "./types.js";

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export class DriftDetector {
  /**
   * Compute a deterministic SHA-256 hex hash for a set of tool definitions.
   * Tools are sorted by name, and all object keys are recursively sorted.
   */
  canonicalHash(tools: ToolDef[]): string {
    const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
    const canonical = sorted.map((t) => this.sortKeys(t));
    const json = JSON.stringify(canonical);
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(json);
    return hasher.digest("hex");
  }

  /**
   * Compute the differences between a baseline tool set and the current tool set.
   */
  diff(baseline: ToolDef[], current: ToolDef[]): DriftChange[] {
    const changes: DriftChange[] = [];
    const baselineMap = new Map<string, ToolDef>();
    const currentMap = new Map<string, ToolDef>();

    for (const tool of baseline) {
      baselineMap.set(tool.name, tool);
    }
    for (const tool of current) {
      currentMap.set(tool.name, tool);
    }

    // Detect added tools
    for (const [name] of currentMap) {
      if (!baselineMap.has(name)) {
        changes.push({
          type: "added",
          tool_name: name,
          severity: "high",
          details: `Tool "${name}" was added`,
        });
      }
    }

    // Detect removed tools
    for (const [name] of baselineMap) {
      if (!currentMap.has(name)) {
        changes.push({
          type: "removed",
          tool_name: name,
          severity: "high",
          details: `Tool "${name}" was removed`,
        });
      }
    }

    // Detect modified tools
    for (const [name, baselineTool] of baselineMap) {
      const currentTool = currentMap.get(name);
      if (!currentTool) continue;

      const baselineSchema = JSON.stringify(this.sortKeys(baselineTool.inputSchema));
      const currentSchema = JSON.stringify(this.sortKeys(currentTool.inputSchema));
      const schemaChanged = baselineSchema !== currentSchema;

      const descriptionChanged = (baselineTool.description ?? "") !== (currentTool.description ?? "");

      if (schemaChanged) {
        changes.push({
          type: "modified",
          tool_name: name,
          severity: "critical",
          details: `Tool "${name}" inputSchema was modified`,
        });
      } else if (descriptionChanged) {
        changes.push({
          type: "modified",
          tool_name: name,
          severity: "low",
          details: `Tool "${name}" description was modified`,
        });
      }
    }

    return changes;
  }

  /**
   * Recursively sort object keys for deterministic serialization.
   * Arrays preserve order. Primitives pass through unchanged.
   */
  private sortKeys(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map((item) => this.sortKeys(item));
    if (typeof obj === "object") {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
        sorted[key] = this.sortKeys((obj as Record<string, unknown>)[key]);
      }
      return sorted;
    }
    return obj;
  }
}

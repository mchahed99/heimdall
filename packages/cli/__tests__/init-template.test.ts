import { describe, expect, test } from "bun:test";
import { loadBifrostConfig } from "@heimdall/core";
import { WardEngine } from "@heimdall/core";
import { DEFAULT_BIFROST } from "../src/commands/init.js";

describe("DEFAULT_BIFROST template", () => {
  test("parses without errors", () => {
    expect(() => loadBifrostConfig(DEFAULT_BIFROST)).not.toThrow();
  });

  test("reshape-destructive-to-preview catches 'rm -rf /'", () => {
    const config = loadBifrostConfig(DEFAULT_BIFROST);
    const engine = new WardEngine(config);

    const result = engine.evaluate({
      tool_name: "Bash",
      arguments: { command: "rm -rf /" },
      session_id: "test",
    });
    expect(result.decision).toBe("RESHAPE");
    expect(result.matched_wards).toContain("reshape-destructive-to-preview");
    expect(result.reshaped_arguments).toBeDefined();
    expect(result.reshaped_arguments!.command).toContain("HEIMDALL RESHAPE");
  });

  test("reshape-destructive-to-preview catches 'rm  -rf' with extra spaces", () => {
    const config = loadBifrostConfig(DEFAULT_BIFROST);
    const engine = new WardEngine(config);

    const result = engine.evaluate({
      tool_name: "Bash",
      arguments: { command: "rm  -rf /home" },
      session_id: "test",
    });
    expect(result.decision).toBe("RESHAPE");
  });

  test("halt-privilege-escalation catches 'sudo apt install'", () => {
    const config = loadBifrostConfig(DEFAULT_BIFROST);
    const engine = new WardEngine(config);

    const result = engine.evaluate({
      tool_name: "Bash",
      arguments: { command: "sudo apt install curl" },
      session_id: "test",
    });
    expect(result.decision).toBe("HALT");
    expect(result.matched_wards).toContain("halt-privilege-escalation");
  });

  test("reshape-safe-permissions catches 'chmod 777'", () => {
    const config = loadBifrostConfig(DEFAULT_BIFROST);
    const engine = new WardEngine(config);

    const result = engine.evaluate({
      tool_name: "Bash",
      arguments: { command: "chmod 777 /etc/passwd" },
      session_id: "test",
    });
    expect(result.decision).toBe("RESHAPE");
    expect(result.matched_wards).toContain("reshape-safe-permissions");
    expect(result.reshaped_arguments).toBeDefined();
    expect(result.reshaped_arguments!.command).toContain("755");
  });

  test("flag-network-calls matches 'curl https://...'", () => {
    const config = loadBifrostConfig(DEFAULT_BIFROST);
    const engine = new WardEngine(config);

    const result = engine.evaluate({
      tool_name: "Bash",
      arguments: { command: "curl https://example.com" },
      session_id: "test",
    });
    // Action is PASS (just flagged for audit), but ward should match
    expect(result.matched_wards).toContain("flag-network-calls");
  });

  test("detect-secrets catches OpenAI API key", () => {
    const config = loadBifrostConfig(DEFAULT_BIFROST);
    const engine = new WardEngine(config);

    const result = engine.evaluate({
      tool_name: "Bash",
      arguments: { command: "export OPENAI_KEY=sk-abcdefghijklmnopqrstuvwxyz" },
      session_id: "test",
    });
    expect(result.decision).toBe("HALT");
    expect(result.matched_wards).toContain("detect-secrets");
  });

  test("safe commands pass through", () => {
    const config = loadBifrostConfig(DEFAULT_BIFROST);
    const engine = new WardEngine(config);

    const result = engine.evaluate({
      tool_name: "Bash",
      arguments: { command: "echo hello world" },
      session_id: "test",
    });
    expect(result.decision).toBe("PASS");
  });
});

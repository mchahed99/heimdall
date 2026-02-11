import { describe, expect, test } from "bun:test";
import { loadBifrostConfig } from "../src/yaml-loader.js";

describe("YAML loader enhancements", () => {
  describe("environment variable interpolation", () => {
    test("replaces ${VAR} with env value", () => {
      process.env.TEST_WEBHOOK_URL = "https://hooks.slack.com/test";
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
sinks:
  - type: webhook
    url: "\${TEST_WEBHOOK_URL}"
`);
      expect(config.sinks).toHaveLength(1);
      expect(config.sinks![0].url).toBe("https://hooks.slack.com/test");
      delete process.env.TEST_WEBHOOK_URL;
    });

    test("supports default values ${VAR:-default}", () => {
      delete process.env.MISSING_VAR;
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
sinks:
  - type: opentelemetry
    endpoint: "\${MISSING_VAR:-http://localhost:4318}"
`);
      expect(config.sinks![0].endpoint).toBe("http://localhost:4318");
    });

    test("throws on missing env var with no default", () => {
      delete process.env.NONEXISTENT;
      expect(() =>
        loadBifrostConfig(`
version: "1"
realm: test
wards: []
sinks:
  - type: webhook
    url: "\${NONEXISTENT}"
`)
      ).toThrow("required environment variable 'NONEXISTENT' is not set");
    });
  });

  describe("sinks config section", () => {
    test("parses sinks array from config", () => {
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
sinks:
  - type: stdout
    events: [HALT]
  - type: webhook
    url: https://example.com/hook
    headers:
      Authorization: "Bearer token"
`);
      expect(config.sinks).toHaveLength(2);
      expect(config.sinks![0].type).toBe("stdout");
      expect(config.sinks![0].events).toEqual(["HALT"]);
      expect(config.sinks![1].type).toBe("webhook");
      expect(config.sinks![1].url).toBe("https://example.com/hook");
    });

    test("sinks defaults to empty array when absent", () => {
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
`);
      expect(config.sinks).toEqual([]);
    });
  });

  describe("storage config section", () => {
    test("parses storage adapter config", () => {
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
storage:
  adapter: sqlite
  path: .heimdall/runes.sqlite
`);
      expect(config.storage?.adapter).toBe("sqlite");
      expect(config.storage?.path).toBe(".heimdall/runes.sqlite");
    });

    test("storage defaults to undefined when absent", () => {
      const config = loadBifrostConfig(`
version: "1"
realm: test
wards: []
`);
      expect(config.storage).toBeUndefined();
    });
  });

  describe("extends field", () => {
    test("extends field is parsed from config", () => {
      const config = loadBifrostConfig(`
version: "1"
realm: test
extends:
  - ./base.yaml
wards: []
`);
      expect(config.extends).toEqual(["./base.yaml"]);
    });
  });
});

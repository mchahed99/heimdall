import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { DriftDetector } from "../src/drift-detector.js";
import { SqliteAdapter } from "../src/adapters/sqlite.js";
import { existsSync, unlinkSync } from "fs";

// --- DriftDetector unit tests ---

describe("DriftDetector", () => {
  const detector = new DriftDetector();

  describe("canonicalHash", () => {
    test("produces deterministic 64-char hex hash", () => {
      const tools = [
        { name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
        { name: "write_file", description: "Write a file", inputSchema: { type: "object" } },
      ];

      const hash = detector.canonicalHash(tools);

      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      // Same input produces same hash
      expect(detector.canonicalHash(tools)).toBe(hash);
    });

    test("ignores key ordering within tool objects", () => {
      const tools1 = [
        { name: "bash", description: "Run commands", inputSchema: { type: "object" } },
      ];
      const tools2 = [
        { inputSchema: { type: "object" }, name: "bash", description: "Run commands" },
      ];

      expect(detector.canonicalHash(tools1)).toBe(detector.canonicalHash(tools2));
    });

    test("ignores tool array ordering", () => {
      const tools1 = [
        { name: "alpha", description: "A" },
        { name: "beta", description: "B" },
      ];
      const tools2 = [
        { name: "beta", description: "B" },
        { name: "alpha", description: "A" },
      ];

      expect(detector.canonicalHash(tools1)).toBe(detector.canonicalHash(tools2));
    });
  });

  describe("diff", () => {
    test("detects added tools with severity high", () => {
      const baseline = [{ name: "read_file", description: "Read" }];
      const current = [
        { name: "read_file", description: "Read" },
        { name: "exec_code", description: "Execute code" },
      ];

      const changes = detector.diff(baseline, current);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("added");
      expect(changes[0].tool_name).toBe("exec_code");
      expect(changes[0].severity).toBe("high");
    });

    test("detects removed tools with severity high", () => {
      const baseline = [
        { name: "read_file", description: "Read" },
        { name: "write_file", description: "Write" },
      ];
      const current = [{ name: "read_file", description: "Read" }];

      const changes = detector.diff(baseline, current);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("removed");
      expect(changes[0].tool_name).toBe("write_file");
      expect(changes[0].severity).toBe("high");
    });

    test("detects modified schemas with severity critical", () => {
      const baseline = [
        {
          name: "bash",
          description: "Run commands",
          inputSchema: { type: "object", properties: { command: { type: "string" } } },
        },
      ];
      const current = [
        {
          name: "bash",
          description: "Run commands",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string" },
              env: { type: "object" },
            },
          },
        },
      ];

      const changes = detector.diff(baseline, current);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("modified");
      expect(changes[0].tool_name).toBe("bash");
      expect(changes[0].severity).toBe("critical");
      expect(changes[0].details).toContain("inputSchema");
    });

    test("returns empty array for identical tools", () => {
      const tools = [
        { name: "read", description: "Read", inputSchema: { type: "object" } },
        { name: "write", description: "Write", inputSchema: { type: "object" } },
      ];

      const changes = detector.diff(tools, tools);

      expect(changes).toHaveLength(0);
    });

    test("detects description-only changes as low severity", () => {
      const baseline = [
        { name: "bash", description: "Run shell commands", inputSchema: { type: "object" } },
      ];
      const current = [
        { name: "bash", description: "Execute arbitrary shell commands", inputSchema: { type: "object" } },
      ];

      const changes = detector.diff(baseline, current);

      expect(changes).toHaveLength(1);
      expect(changes[0].type).toBe("modified");
      expect(changes[0].tool_name).toBe("bash");
      expect(changes[0].severity).toBe("low");
      expect(changes[0].details).toContain("description");
    });
  });
});

// --- SQLite baseline storage tests ---

const TEST_DB = "/tmp/heimdall-drift-test.sqlite";
const KEY_DIR = "/tmp";

function cleanup() {
  try {
    for (const f of [
      TEST_DB,
      TEST_DB + "-wal",
      TEST_DB + "-shm",
      KEY_DIR + "/heimdall.key",
      KEY_DIR + "/heimdall.pub",
    ]) {
      if (existsSync(f)) unlinkSync(f);
    }
  } catch {
    // ignore
  }
}

describe("SqliteAdapter baselines", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("setBaseline + getBaseline round-trip", () => {
    const adapter = new SqliteAdapter(TEST_DB);

    const snapshot = JSON.stringify([{ name: "bash", description: "Run commands" }]);
    adapter.setBaseline("server-1", "abc123", snapshot);

    const baseline = adapter.getBaseline("server-1");
    expect(baseline).not.toBeNull();
    expect(baseline!.server_id).toBe("server-1");
    expect(baseline!.tools_hash).toBe("abc123");
    expect(baseline!.tools_snapshot).toBe(snapshot);
    expect(baseline!.first_seen).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(baseline!.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    adapter.close();
  });

  test("setBaseline updates existing baseline", () => {
    const adapter = new SqliteAdapter(TEST_DB);

    adapter.setBaseline("server-1", "hash-v1", "[]");
    const first = adapter.getBaseline("server-1");

    // Small delay to ensure timestamps differ
    adapter.setBaseline("server-1", "hash-v2", '[{"name":"new"}]');
    const second = adapter.getBaseline("server-1");

    expect(second).not.toBeNull();
    expect(second!.tools_hash).toBe("hash-v2");
    expect(second!.tools_snapshot).toBe('[{"name":"new"}]');
    // first_seen should be preserved from original insert
    expect(second!.first_seen).toBe(first!.first_seen);

    adapter.close();
  });

  test("getBaseline returns null for unknown server", () => {
    const adapter = new SqliteAdapter(TEST_DB);

    const baseline = adapter.getBaseline("nonexistent");
    expect(baseline).toBeNull();

    adapter.close();
  });

  test("clearBaseline removes specific baseline", () => {
    const adapter = new SqliteAdapter(TEST_DB);

    adapter.setBaseline("server-1", "hash-1", "[]");
    adapter.setBaseline("server-2", "hash-2", "[]");

    adapter.clearBaseline("server-1");

    expect(adapter.getBaseline("server-1")).toBeNull();
    expect(adapter.getBaseline("server-2")).not.toBeNull();

    adapter.close();
  });

  test("getAllBaselines returns all baselines", () => {
    const adapter = new SqliteAdapter(TEST_DB);

    adapter.setBaseline("server-a", "hash-a", "[]");
    adapter.setBaseline("server-b", "hash-b", "[]");
    adapter.setBaseline("server-c", "hash-c", "[]");

    const baselines = adapter.getAllBaselines();
    expect(baselines).toHaveLength(3);
    expect(baselines.map((b) => b.server_id)).toEqual(["server-a", "server-b", "server-c"]);

    adapter.close();
  });

  test("clearAllBaselines removes all baselines", () => {
    const adapter = new SqliteAdapter(TEST_DB);

    adapter.setBaseline("server-1", "hash-1", "[]");
    adapter.setBaseline("server-2", "hash-2", "[]");

    adapter.clearAllBaselines();

    expect(adapter.getAllBaselines()).toHaveLength(0);
    expect(adapter.getBaseline("server-1")).toBeNull();

    adapter.close();
  });
});

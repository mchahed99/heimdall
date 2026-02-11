import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadBifrostFile } from "../src/yaml-loader.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";

const TEST_DIR = "/tmp/heimdall-compose-test";

function setup() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

describe("Policy Composition", () => {
  beforeEach(setup);
  afterEach(teardown);

  test("extends merges wards from local files", async () => {
    writeFileSync(`${TEST_DIR}/base.yaml`, `
version: "1"
realm: base
wards:
  - id: base-ward
    tool: Bash
    action: HALT
    message: Base ward
    severity: high
`);

    writeFileSync(`${TEST_DIR}/bifrost.yaml`, `
version: "1"
realm: myproject
extends:
  - ./base.yaml
wards:
  - id: local-ward
    tool: Read
    action: PASS
    message: Local ward
    severity: low
`);

    const config = await loadBifrostFile(`${TEST_DIR}/bifrost.yaml`);

    expect(config.wards).toHaveLength(2);
    expect(config.wards.map((w) => w.id)).toContain("base-ward");
    expect(config.wards.map((w) => w.id)).toContain("local-ward");
  });

  test("local wards come after extended wards", async () => {
    writeFileSync(`${TEST_DIR}/base.yaml`, `
version: "1"
realm: base
wards:
  - id: ward-a
    tool: "*"
    when:
      always: true
    action: PASS
    message: Base pass
    severity: low
`);

    writeFileSync(`${TEST_DIR}/bifrost.yaml`, `
version: "1"
realm: test
extends:
  - ./base.yaml
wards:
  - id: ward-b
    tool: Bash
    action: HALT
    message: Local halt
    severity: critical
`);

    const config = await loadBifrostFile(`${TEST_DIR}/bifrost.yaml`);
    expect(config.wards[0].id).toBe("ward-a");
    expect(config.wards[1].id).toBe("ward-b");
  });

  test("missing extends file throws", async () => {
    writeFileSync(`${TEST_DIR}/bifrost.yaml`, `
version: "1"
realm: test
extends:
  - ./nonexistent.yaml
wards: []
`);

    expect(loadBifrostFile(`${TEST_DIR}/bifrost.yaml`)).rejects.toThrow();
  });
});

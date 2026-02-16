/**
 * Tamper test — modifies rune #3 to demonstrate tamper detection.
 *
 * Changes `tool_name` from its real value to 'FAKE', which breaks
 * the content hash and will be caught by `heimdall runecheck`.
 *
 * Usage: bun run scripts/tamper.ts
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const DB_PATH = resolve(import.meta.dirname, "../.heimdall/runes.sqlite");
const db = new Database(DB_PATH);

db.run("UPDATE runes SET tool_name = 'FAKE' WHERE sequence = 3");

console.error("Tampered rune #3: tool_name → 'FAKE'");
db.close();

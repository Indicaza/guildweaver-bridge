import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { logDomain, redact, parseLog } from "../src/cli/logs.js";
const entry = fileURLToPath(new URL("../src/gw.js", import.meta.url));
test("gw help advertises the command center and status is parseable JSON", () => {
  const help = spawnSync(process.execPath, [entry, "help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /gw dev logs/);
  const status = spawnSync(process.execPath, [entry, "status", "--json"], { encoding: "utf8" });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(typeof JSON.parse(status.stdout).paired, "boolean");
});
test("legacy log domains and credentials are handled safely", () => {
  assert.equal(logDomain("Auction ingestion paused"), "ah");
  assert.equal(logDomain("Synced telemetry character revision 42"), "character");
  assert.equal(parseLog("[2026-11-25T00:00:00Z] ERROR HTTP 503").level, "ERROR");
  assert.equal(redact("Authorization: Bearer gwd_secret"), "Authorization: [redacted] [redacted]");
  assert.ok(!redact("deviceToken=gwp_example").includes("gwp_example"));
});

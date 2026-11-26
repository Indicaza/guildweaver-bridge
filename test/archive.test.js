import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { runArchiveCommand } from "../src/archive.js";

test("archive commands require explicit destination and verify batches without overwriting", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gw-archive-"));
  try {
    const credentialsPath = path.join(directory, "credentials.json");
    const output = path.join(directory, "batch.json.gz");
    const config = { holdfastUrl: "https://example.test", credentialsPath };
    const args = ["pull", "--dataset", "market-monthly", "--market", "test", "--out", output];
    const batch = { schemaVersion: 1, dataset: "market-monthly", market: "test", cursor: null,
      exportedAt: "2026-11-25T00:00:00.000Z", nextCursor: "next", rows: [{ item_key: "i:1" }] };
    const result = { batch, sha256: createHash("sha256").update(JSON.stringify(batch)).digest("hex") };
    let calls = 0;
    const ticket = "00000000-0000-0000-0000-000000000001";
    const fetchImpl = async (url, options) => {
      if (options.method === "DELETE") return new Response(null, { status: 204 });
      calls++;
      assert.equal(options.headers.Authorization, "Bearer test-token");
      assert.ok(url.startsWith("https://example.test/api/bridge/archive/"));
      return new Response(JSON.stringify(url.endsWith("/status") ? { enabled: false } : { status: "ready", ticket, result }));
    };
    const options = { fetchImpl, log: () => {} };
    await assert.rejects(runArchiveCommand(config, args, options), /Pair this computer/);
    fs.writeFileSync(credentialsPath, JSON.stringify({ deviceToken: "test-token" }));
    await runArchiveCommand(config, ["status"], options);
    assert.equal(fs.existsSync(output), false);
    await assert.rejects(runArchiveCommand(config, args.slice(0, -2), options), /explicit --out/);
    assert.equal(calls, 1);
    await assert.rejects(runArchiveCommand(config, args, { ...options, fetchImpl: async () =>
      new Response(JSON.stringify({ status: "ready", ticket, result: { ...result, sha256: "bad" } })) }), /checksum mismatch/);
    assert.equal(fs.existsSync(output), false);
    await runArchiveCommand(config, args, options);
    assert.deepEqual(JSON.parse(gunzipSync(fs.readFileSync(output))), result);
    await assert.rejects(runArchiveCommand(config, args, options), /already exists/);
    assert.equal(calls, 2);
    assert.deepEqual(JSON.parse(gunzipSync(fs.readFileSync(output))), result);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

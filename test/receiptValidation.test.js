import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { syncOnce } from "../src/sync.js";

test("malformed and mismatched successful HTTP responses never mark telemetry delivered", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gw-receipt-"));
  const config = {
    savedVariablesPath: path.join(directory, "Guildweaver.lua"),
    statePath: path.join(directory, "state.json"),
    holdfastUrl: "https://example.test",
    telemetryEndpoint: "https://example.test/api/bridge/telemetry",
    deviceToken: "test-device",
    questSyncIntervalMs: Number.MAX_SAFE_INTEGER,
  };
  fs.writeFileSync(config.savedVariablesPath, 'GuildweaverDB = {gameRelease="forever-live",schemaVersion=4,sync={outbound={telemetry={["test"]={kind="event",revision=1,fingerprint="fingerprint",envelope={schemaVersion=1,eventType="test",capturedAt=1791450000,payload={value=1}}}}}}}');
  try {
    for (const malformed of [
      () => new Response("<html>ok</html>"),
      () => new Response(JSON.stringify({status:"created"})),
      (receipt) => new Response(JSON.stringify({...receipt, receiptKey:"wrong"})),
      (receipt) => new Response(JSON.stringify({...receipt, revision:2})),
      (receipt) => new Response(JSON.stringify({...receipt, streamKey:"other"})),
    ]) {
      const result = await syncOnce(config, {log:()=>{}, fetchImpl:async (_url, options) => malformed({
        status:"created",recordId:1,streamKey:"test",revision:1,receiptKey:options.headers["Idempotency-Key"]
      })});
      assert.equal(result.telemetrySent,0);
      assert.equal(result.telemetryFailed,1);
      if (fs.existsSync(config.statePath)) assert.equal(Object.keys(JSON.parse(fs.readFileSync(config.statePath)).sentTelemetryRevisions).length,0);
    }
    const result = await syncOnce(config, {log:()=>{}, fetchImpl:async (_url, options) =>
      new Response(JSON.stringify({status:"duplicate",recordId:1,streamKey:"test",revision:1,receiptKey:options.headers["Idempotency-Key"]}))});
    assert.equal(result.telemetrySent,1);
    assert.equal(Object.values(JSON.parse(fs.readFileSync(config.statePath)).sentTelemetryRevisions)[0],1);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

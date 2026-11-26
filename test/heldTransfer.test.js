import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runArchiveCommand } from "../src/archive.js";

const holdId = "00000000-0000-0000-0000-000000000001";
const ticket = "00000000-0000-0000-0000-000000000002";
const datasets = ["market-current", "market-hourly", "market-daily", "market-weekly", "market-monthly-all"];
const json = body => new Response(JSON.stringify(body));

test("all market transfer resumes under the same hold and verifies every saved chain", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-held-transfer-"));
  try {
    const credentialsPath = path.join(root, "credentials.json");
    fs.writeFileSync(credentialsPath, JSON.stringify({ deviceToken: "test-token" }));
    const directory = path.join(root, "transfer");
    const config = { holdfastUrl: "https://example.test", credentialsPath };
    const args = ["pull-all", "--dir", directory];
    const requests = [];
    const status = { enabled: true, hold: { id: holdId }, marketsTruncated: false, datasets, markets: [{ key: "market:a" }] };
    const fetchImpl = async (url, options) => {
      if (url.endsWith("/status")) return json(status);
      if (options.method === "DELETE") return new Response(null, { status: 204 });
      const query = JSON.parse(options.body);
      assert.equal(query.holdId, holdId);
      requests.push(query.dataset);
      const batch = { schemaVersion: 1, dataset: query.dataset, market: query.market, holdId: query.holdId, cursor: query.cursor ?? null, nextCursor: null, rows: [{ item_key: "i:1" }] };
      return json({ ticket, status: "ready", result: { batch, sha256: createHash("sha256").update(JSON.stringify(batch)).digest("hex") } });
    };
    const controller = new AbortController();
    await assert.rejects(runArchiveCommand(config, args, {
      fetchImpl, log: () => {}, signal: controller.signal,
      progress: event => { if (event.stage === "saved") controller.abort(new Error("interrupted")); },
    }), /interrupted/);
    const options = { log: () => {}, fetchImpl };
    const partial = await runArchiveCommand({}, ["verify-all", "--dir", directory], { log: () => {} });
    assert.equal(partial.complete, false);
    assert.equal(partial.datasetsComplete, 1);
    const report = await runArchiveCommand(config, args, options);
    assert.deepEqual(requests, datasets);
    assert.equal(report.complete, true);
    assert.equal(report.datasetsComplete, 5);
    assert.equal(report.rows, 5);
    assert.ok(fs.existsSync(report.receipt));
    assert.equal((await runArchiveCommand({}, ["verify-all", "--dir", directory], { log: () => {} })).complete, true);
    status.hold.id = "00000000-0000-0000-0000-000000000003";
    await assert.rejects(runArchiveCommand(config, args, options), /another website, hold or market list/);
    const plan = JSON.parse(fs.readFileSync(path.join(directory, "transfer.json"), "utf8"));
    fs.rmSync(path.join(directory, plan.entries[0].directory, "batch-000001.json.gz"));
    await assert.rejects(runArchiveCommand({}, ["verify-all", "--dir", directory], { log: () => {} }), /no longer matches/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

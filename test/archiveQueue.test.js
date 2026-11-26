import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runArchiveCommand } from "../src/archive.js";
import { queuedArchivePage } from "../src/archiveTransport.js";

const ticket = "00000000-0000-0000-0000-000000000001";
const config = { holdfastUrl: "https://example.test" };
function result(cursor, nextCursor) {
  const batch = { schemaVersion: 1, dataset: "market-monthly", market: "test", cursor,
    exportedAt: "2026-11-25T00:00:00.000Z", nextCursor, rows: [{ item_key: "item:" + (cursor || "first") }] };
  return { batch, sha256: createHash("sha256").update(JSON.stringify(batch)).digest("hex") };
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

test("queued download obeys admission backpressure, polls ticket and reports position", async () => {
  let clock = 0, calls = 0;
  const events = [], waits = [];
  const fetchImpl = async (url, options) => {
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    calls++;
    if (calls === 1) return json({ error: "archive_queue_full" }, 503, { "Retry-After": "5" });
    if (calls === 2) { assert.equal(options.method, "POST"); return json({ ticket, status: "queued", position: 4 }, 202); }
    assert.ok(url.endsWith(ticket));
    if (calls === 3) return json({ ticket, status: "queued", position: 1 }, 202);
    if (calls === 4) return json({ ticket, status: "running", position: 0 }, 202);
    return json({ ticket, status: "ready", result: result(null, null) });
  };
  const page = await queuedArchivePage(config, { deviceToken: "token" }, { dataset: "market-monthly", market: "test" }, {
    fetchImpl, now: () => clock, random: () => 0.5, sleepImpl: async ms => { waits.push(ms); clock += ms; },
    progress: event => events.push(event),
  });
  assert.equal(page.result.batch.rows.length, 1);
  assert.ok(waits[0] >= 5000);
  assert.deepEqual(events.filter(event => event.stage === "queued").map(event => event.position), [4, 1]);
  assert.ok(events.some(event => event.stage === "received"));
  await page.release();
});

test("interrupted export resumes from verified pages without overwriting", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-archive-resume-"));
  try {
    const credentialsPath = path.join(root, "credentials.json");
    fs.writeFileSync(credentialsPath, JSON.stringify({ deviceToken: "token" }));
    const directory = path.join(root, "archive");
    const args = ["pull", "--dataset", "market-monthly", "--market", "test", "--dir", directory];
    const controller = new AbortController();
    const cursors = [];
    const fetchImpl = async (_url, options) => {
      if (options.method === "DELETE") return new Response(null, { status: 204 });
      const query = JSON.parse(options.body);
      const cursor = query.cursor ?? null;
      cursors.push(cursor);
      return json({ ticket, status: "ready", result: result(cursor, cursor === null ? "next" : null) });
    };
    await assert.rejects(runArchiveCommand({ ...config, credentialsPath }, args, {
      fetchImpl, log: () => {}, signal: controller.signal,
      progress: event => { if (event.stage === "saved") controller.abort(new Error("interrupted")); },
    }), /interrupted/);
    const first = path.join(directory, "batch-000001.json.gz");
    const original = fs.readFileSync(first);
    const report = await runArchiveCommand({ ...config, credentialsPath }, args, { fetchImpl, log: () => {} });
    assert.deepEqual(cursors, [null, "next"]);
    assert.equal(report.complete, true);
    assert.equal(report.pages, 2);
    assert.deepEqual(fs.readFileSync(first), original);
    const verified = await runArchiveCommand({}, ["verify", "--dir", directory], { log: () => {}, fetchImpl: assert.fail });
    assert.equal(verified.complete, true);
    fs.writeFileSync(first, "corrupt");
    await assert.rejects(runArchiveCommand({}, ["verify", "--dir", directory], { log: () => {} }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

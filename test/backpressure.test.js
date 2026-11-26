import assert from "node:assert/strict";
import test from "node:test";
import { createBackpressure } from "../src/backpressure.js";

test("manual and scheduled traffic share Retry-After cooldown", async () => {
  let clock = 1000, calls = 0;
  const pressure = createBackpressure({
    now: () => clock, random: () => 0.5,
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? new Response("busy", { status: 503, headers: {
        "Retry-After": "5", "X-Guildweaver-Backpressure": "1",
      } }) : new Response("ok");
    },
  });
  await assert.rejects(pressure.fetch("https://example.test"), /Retry in 6s/);
  await assert.rejects(pressure.fetch("https://example.test"), /Website busy/);
  assert.equal(calls, 1);
  clock += 5999;
  assert.throws(() => pressure.check(), /Website busy/);
  clock += 1;
  assert.equal((await pressure.fetch("https://example.test")).status, 200);
  assert.equal(calls, 2);
});

test("an admin-paused AH endpoint does not freeze unrelated sync", async () => {
  const pressure = createBackpressure({ fetchImpl: async () =>
    new Response(JSON.stringify({ error: "auction_ingestion_paused" }), { status: 503, headers: { "Retry-After": "300" } }),
  });
  assert.equal((await pressure.fetch("https://example.test")).status, 503);
  assert.equal(pressure.remainingMs(), 0);
});

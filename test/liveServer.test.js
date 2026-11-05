import assert from "node:assert/strict";
import test from "node:test";
import { createLiveServerCheck } from "../src/liveServer.js";

test("uploads wait for the migrated website and retry after deployment", async () => {
  let time = 0;
  let requests = 0;
  const check = createLiveServerCheck({ holdfastUrl: "https://example.test" }, {
    now: () => time,
    fetchImpl: async (url) => {
      assert.equal(url, "https://example.test/api/bridge/release");
      requests += 1;
      return requests === 1 ? new Response("old site", { status: 404 })
        : Response.json({ gameRelease: "forever-live" });
    },
  });
  await assert.rejects(check(), /Waiting/);
  await assert.rejects(check(), /Waiting/);
  assert.equal(requests, 1);
  time = 15000;
  await check();
  await check();
  assert.equal(requests, 2);
});

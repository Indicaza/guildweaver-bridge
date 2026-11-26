import assert from "node:assert/strict";
import test from "node:test";
import { completeBridgeUpdate } from "../src/cli/completeUpdate.js";
const commit = "a".repeat(40);
const staged = () => ({ addon: { status: "current" }, bridge: { status: "restart-scheduled", previousPid: 1, commit } });
test("activation waits for the new process running the requested commit", async () => {
  let clock = 0, probes = 0;
  const result = staged();
  await completeBridgeUpdate({}, result, {
    now: () => clock, wait: async ms => { clock += ms; },
    lockStatus: () => ({ running: true, pid: clock < 500 ? 1 : 2 }),
    request: async () => ({ ready: true, pid: 2, commit: ++probes === 1 ? "b".repeat(40) : commit }),
    timeoutMs: 2000,
  });
  assert.equal(probes, 2);
  assert.equal(result.bridge.status, "updated");
  assert.equal(result.addon.status, "current");
});
test("a missing replacement times out as failed, never current", async () => {
  let clock = 0;
  const result = staged();
  await completeBridgeUpdate({}, result, {
    now: () => clock, wait: async ms => { clock += ms; },
    lockStatus: () => ({ running: true, pid: 1 }), timeoutMs: 1000,
    request: async () => { throw new Error("must not probe old process"); },
  });
  assert.equal(result.bridge.status, "failed");
  assert.match(result.bridge.detail, /did not confirm startup/);
});
test("current bridge does not restart", async () => {
  const result = { bridge: { status: "package-current" } };
  assert.equal(await completeBridgeUpdate({}, result), result);
});

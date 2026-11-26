import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startAgent, requestAgent } from "../src/agent.js";
import { notify, setNotifications, notificationsEnabled } from "../src/notifications.js";

test("local agent dispatches authenticated requests and rejects invalid tokens", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gw-agent-test-"));
  const config = { lockPath: path.join(directory, "bridge.lock") };
  let calls = 0;
  const close = await startAgent(config, async (command, args) => { calls++; return { command, args }; });
  try {
    assert.deepEqual(await requestAgent(config, "sync", ["ah"]), { command: "sync", args: ["ah"] });
    const file = config.lockPath + ".agent.json";
    const descriptor = JSON.parse(fs.readFileSync(file));
    fs.writeFileSync(file, JSON.stringify({ ...descriptor, token: "invalid" }));
    await assert.rejects(requestAgent(config, "sync", []), /authorization failed/);
    assert.equal(calls, 1);
    fs.writeFileSync(file, JSON.stringify(descriptor));
  } finally { close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test("notifications are opt-out and failures remain nonfatal", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gw-notify-test-"));
  const config = { dataDirectory: directory };
  const calls = [];
  const execImpl = async (...args) => calls.push(args);
  try {
    assert.equal(notificationsEnabled(config), true);
    setNotifications(config, false);
    assert.equal((await notify(config, "GW", "message", { platform: "linux", execImpl })).status, "disabled");
    assert.equal(calls.length, 0);
    assert.equal((await notify(config, "GW", "message", { platform: "linux", test: true, execImpl })).status, "requested");
    assert.equal(calls[0][0], "notify-send");
    setNotifications(config, true);
    assert.equal((await notify(config, "GW", "message", { platform: "darwin", execImpl: async () => { throw Error("no desktop"); } })).status, "unavailable");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

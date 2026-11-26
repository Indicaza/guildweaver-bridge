import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadUpdate } from "../src/updateDownload.js";
import { createUpdateProgress, updateActivity, updateAction } from "../src/cli/updateProgress.js";

test("downloads report real bytes and reject truncated responses", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gw-update-progress-"));
  const events = [];
  try {
    const destination = path.join(directory, "package.zip");
    await downloadUpdate(new Response("hello", { headers: { "content-length": "5" } }), destination, event => events.push(event));
    assert.equal(fs.readFileSync(destination, "utf8"), "hello");
    assert.deepEqual(events[0], { stage: "downloading", received: 0, total: 5 });
    assert.deepEqual(events.at(-1), { stage: "downloaded", received: 5, total: 5 });
    await assert.rejects(downloadUpdate(new Response("short", { headers: { "content-length": "12" } }), path.join(directory, "bad.zip")), /incomplete/);
    assert.match(updateActivity({ stage: "downloading", received: 128, total: 256 }), /50%/);
    assert.doesNotMatch(updateActivity({ stage: "downloading", received: 128, total: null }), /%/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("status panel appears before progress, and reload is only requested for a changed addon", () => {
  let output = "";
  const renderer = createUpdateProgress("all", { stream: { isTTY: false, write: text => { output += text; } } });
  renderer.start();
  assert.match(output, /Addon.*Updating/);
  assert.match(output, /Bridge.*Updating/);
  renderer.show({ component: "addon", stage: "available", releaseVersion: "0.5.1" });
  renderer.show({ component: "addon", stage: "verifying" });
  renderer.finish({ addon: { status: "updated", action: "reload" }, bridge: { status: "package-current" } });
  assert.match(output, /applying now/);
  assert.match(output, /Verifying SHA-256/);
  assert.match(output, /\/reload/);
  assert.equal(updateAction({ status: "current" }), "");
  assert.match(updateAction({ status: "updated", action: "next-launch" }), /No reload needed now/);
});


test("both components use identical status wording without release versions", () => {
  let output = "";
  const renderer = createUpdateProgress("all", { stream: { isTTY: false, write: text => { output += text; } } });
  renderer.start();
  renderer.finish({ addon: { status: "current", releaseVersion: "0.5.0" }, bridge: { status: "package-current", releaseVersion: "0.9.0" } });
  assert.match(output, /Addon\s+✓ Current/);
  assert.match(output, /Bridge\s+✓ Current/);
  assert.doesNotMatch(output, /package-current|0\.5\.0|0\.9\.0/);
});

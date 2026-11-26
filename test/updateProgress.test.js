import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { downloadUpdate } from "../src/updateDownload.js";
import { createUpdateProgress, progressBar, updateAction } from "../src/cli/updateProgress.js";

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
    assert.match(progressBar({ stage: "downloading", received: 128, total: 256 }), /50%/);
    assert.doesNotMatch(progressBar({ stage: "downloading", received: 128, total: null }), /%/);
    assert.notEqual(progressBar({ stage: "activation-check" }, 0), progressBar({ stage: "activation-check" }, 1));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("successful output contains only the heading and two matching status rows", () => {
  let output = "";
  const renderer = createUpdateProgress("all", { stream: { isTTY: false, write: text => { output += text; } } });
  renderer.start();
  renderer.show({ component: "addon", stage: "available", releaseVersion: "0.5.1" });
  renderer.show({ component: "addon", stage: "verifying" });
  renderer.finish({ addon: { status: "updated", action: "next-launch", releaseVersion: "0.5.1" }, bridge: { status: "package-current", releaseVersion: "0.9.0" } });
  assert.equal(output, "\n◆ GUILDWEAVER  Update\n  Addon     ✓ Up to date\n  Bridge    ✓ Up to date\n");
});
test("TTY uses an inline progress bar without extra activity rows", () => {
  let output = "";
  const renderer = createUpdateProgress("all", { stream: { isTTY: true, columns: 80, write: text => { output += text; } } });
  renderer.start();
  try {
    renderer.show({ component: "addon", stage: "result", status: "current" });
    renderer.show({ component: "bridge", stage: "downloading", received: 50, total: 100 });
    assert.match(output, /Bridge\s+Updating \[.*\] 50%/);
    renderer.show({ component: "bridge", stage: "result", status: "restart-scheduled" });
    renderer.show({ component: "bridge", stage: "activation-check" });
    assert.match(output, /Bridge\s+Updating \[/);
    renderer.finish({ addon: { status: "current" }, bridge: { status: "updated" } });
    assert.match(output, /Bridge\s+✓ Up to date/);
    assert.doesNotMatch(output, /restart-scheduled|activation pending|Verifying|Update complete/);
  } finally { renderer.fail(); }
});
test("only actionable reloads and failures add detail", () => {
  assert.equal(updateAction({ status: "current" }), "");
  assert.equal(updateAction({ status: "updated", action: "next-launch" }), "");
  assert.match(updateAction({ status: "updated", action: "reload" }), /\/reload/);
  let output = "";
  const renderer = createUpdateProgress("all", { stream: { isTTY: false, write: text => { output += text; } } });
  renderer.start();
  renderer.finish({ addon: { status: "updated", action: "reload" }, bridge: { status: "failed", detail: "Startup not confirmed." } });
  assert.match(output, /Bridge\s+✖ Failed/);
  assert.match(output, /Startup not confirmed/);
  assert.match(output, /\/reload/);
});

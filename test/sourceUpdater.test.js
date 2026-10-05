import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { updateBridgeSource } from "../src/sourceUpdater.js";

function checkout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-bridge-update-"));
  fs.mkdirSync(path.join(root, ".git"));
  return root;
}

test("bridge self-update never touches a dirty checkout", () => {
  const root = checkout();
  const calls = [];

  try {
    const result = updateBridgeSource({
      checkoutPath: root,
      execImpl(command, args) {
        calls.push([command, args]);
        return " M src/cli.js\n";
      },
    });

    assert.equal(result.status, "dirty");
    assert.deepEqual(calls.map(([, args]) => args), [["status", "--porcelain"]]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bridge self-update only touches main", () => {
  const root = checkout();
  const outputs = ["", "feat/cool-shit"];

  try {
    const result = updateBridgeSource({
      checkoutPath: root,
      execImpl() {
        return outputs.shift();
      },
    });

    assert.equal(result.status, "branch");
    assert.equal(result.branch, "feat/cool-shit");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bridge self-update fast-forwards clean main to origin main", () => {
  const root = checkout();
  const outputs = ["", "main", "", "old", "new", "", "new"];
  const calls = [];

  try {
    const result = updateBridgeSource({
      checkoutPath: root,
      execImpl(command, args) {
        calls.push([command, args]);
        return outputs.shift();
      },
    });

    assert.equal(result.status, "updated");
    assert.equal(result.previousCommit, "old");
    assert.equal(result.commit, "new");
    assert.deepEqual(
      calls.map(([, args]) => args),
      [
        ["status", "--porcelain"],
        ["branch", "--show-current"],
        ["fetch", "origin", "main"],
        ["rev-parse", "HEAD"],
        ["rev-parse", "origin/main"],
        ["merge", "--ff-only", "origin/main"],
        ["rev-parse", "HEAD"],
      ],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

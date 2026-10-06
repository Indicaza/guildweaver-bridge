import assert from "node:assert/strict";
import test from "node:test";

import { isWowRunning, processListShowsWow } from "../src/wowProcess.js";

test("processListShowsWow recognizes common WoW process names", () => {
  assert.equal(processListShowsWow('"Wow.exe","1234","Console","1","500,000 K"'), true);
  assert.equal(processListShowsWow('/Applications/World of Warcraft/World of Warcraft.app/Contents/MacOS/World of Warcraft'), true);
  assert.equal(processListShowsWow('/games/wow/WowClassic'), true);
});

test("processListShowsWow ignores launchers and unrelated processes", () => {
  assert.equal(processListShowsWow('Battle.net.exe\nDiscord.exe\nnode.exe'), false);
});

test("isWowRunning uses tasklist on Windows", () => {
  const calls = [];
  const running = isWowRunning({
    platform: "win32",
    spawnSyncImpl(command, args) {
      calls.push({ command, args });
      return { status: 0, stdout: '"Wow.exe","1234","Console","1","500,000 K"' };
    },
  });

  assert.equal(running, true);
  assert.equal(calls[0].command, "tasklist.exe");
});

test("isWowRunning uses ps on macOS and Linux", () => {
  for (const platform of ["darwin", "linux"]) {
    const calls = [];
    const running = isWowRunning({
      platform,
      spawnSyncImpl(command, args) {
        calls.push({ command, args });
        return { status: 0, stdout: "World of Warcraft /Applications/World of Warcraft/World of Warcraft.app" };
      },
    });

    assert.equal(running, true);
    assert.equal(calls[0].command, "ps");
  }
});

test("isWowRunning fails closed when process inspection fails", () => {
  assert.equal(isWowRunning({
    spawnSyncImpl() {
      return { status: 1, stdout: "" };
    },
  }), false);
});

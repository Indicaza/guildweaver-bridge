import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncOnce } from "../src/sync.js";

function savedVariables(revision = 3) {
  return `GuildweaverDB = {
    ["sync"] = {
      ["outbound"] = {
        ["characters"] = {
          ["realm:rook"] = {
            ["revision"] = ${revision},
            ["payload"] = {
              ["schemaVersion"] = 1,
              ["name"] = "Rook",
              ["realm"] = "Realm",
              ["level"] = 20,
              ["race"] = { ["name"] = "Night Elf" },
              ["class"] = { ["name"] = "Warrior" },
              ["professions"] = {},
              ["equipment"] = {},
            },
          },
        },
      },
    },
  }`;
}

test("ignores the retired character mailbox", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-bridge-"));
  const savedVariablesPath = path.join(directory, "Guildweaver.lua");
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(savedVariablesPath, savedVariables(), "utf8");

  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ status: "updated" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const config = {
    holdfastUrl: "https://holdfast.example",
    deviceToken: "gwd_secret",
    savedVariablesPath,
    wowRoot: null,
    pollIntervalMs: 3000,
    questSyncIntervalMs: Number.MAX_SAFE_INTEGER,
    statePath,
  };

  try {
    const result = await syncOnce(config, { fetchImpl, log: () => {} });
    assert.equal(result.telemetryDiscovered, 0);
    assert.equal(requests.length, 0, "whole snapshots are no longer posted");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

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

test("posts each outbound revision once and persists acknowledgment state", async () => {
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
    memberId: "discord-member-1",
    bridgeToken: "secret",
    savedVariablesPath,
    wowRoot: null,
    pollIntervalMs: 3000,
    statePath,
  };

  try {
    const first = await syncOnce(config, { fetchImpl, log: () => {} });
    const second = await syncOnce(config, { fetchImpl, log: () => {} });

    assert.equal(first.sent, 1);
    assert.equal(second.sent, 0);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://holdfast.example/api/bridge/characters/snapshot",
    );
    assert.equal(requests[0].options.headers.Authorization, "Bearer secret");

    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.memberId, "discord-member-1");
    assert.equal(body.revision, 3);
    assert.equal(body.snapshot.name, "Rook");

    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(Object.values(state.sentRevisions)[0], 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("does not acknowledge a revision when the website rejects it", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-bridge-"));
  const savedVariablesPath = path.join(directory, "Guildweaver.lua");
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(savedVariablesPath, savedVariables(), "utf8");

  const config = {
    holdfastUrl: "https://holdfast.example",
    memberId: "discord-member-1",
    bridgeToken: "secret",
    savedVariablesPath,
    wowRoot: null,
    pollIntervalMs: 3000,
    statePath,
  };

  try {
    await assert.rejects(
      syncOnce(config, {
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "invalid_bridge_token" }), {
            status: 401,
          }),
        log: () => {},
      }),
      /invalid_bridge_token/,
    );
    assert.equal(fs.existsSync(statePath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncOnce } from "../src/sync.js";

function source() {
  return `GuildweaverDB = {
    ["schemaVersion"] = 4,
    ["sync"] = {
      ["outbound"] = {
        ["characters"] = {
          ["realm:rook"] = {
            ["revision"] = 15,
            ["payload"] = {
              ["schemaVersion"] = 3,
              ["characterId"] = "character-rook",
              ["name"] = "Rook",
              ["realm"] = "Classic Beta PvE 2",
              ["level"] = 7,
              ["race"] = { ["name"] = "Night Elf" },
              ["class"] = { ["name"] = "Rogue" },
              ["professions"] = {},
              ["equipment"] = {},
            },
          },
          ["realm:quill"] = {
            ["revision"] = 4,
            ["payload"] = {
              ["schemaVersion"] = 3,
              ["characterId"] = "character-quill",
              ["name"] = "Quill",
              ["realm"] = "Classic Beta PvE 2",
              ["level"] = 16,
              ["race"] = { ["name"] = "Human" },
              ["class"] = { ["name"] = "Mage" },
              ["professions"] = {},
              ["equipment"] = {},
            },
          },
        },
        ["telemetry"] = {
          ["character_snapshot:character-rook"] = {
            ["kind"] = "state",
            ["revision"] = 15,
            ["fingerprint"] = "abcdef12",
            ["envelope"] = {
              ["schemaVersion"] = 1,
              ["eventType"] = "character_snapshot",
              ["capturedAt"] = 1791320496,
              ["characterId"] = "character-rook",
              ["realm"] = "Classic Beta PvE 2",
              ["payload"] = {
                ["schemaVersion"] = 3,
                ["characterId"] = "character-rook",
                ["name"] = "Rook",
                ["realm"] = "Classic Beta PvE 2",
                ["level"] = 7,
              },
            },
          },
        },
      },
    },
  }`;
}

test("one rejected character snapshot does not block other characters or generic telemetry", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-resilient-sync-"));
  const savedVariablesPath = path.join(directory, "Guildweaver.lua");
  const statePath = path.join(directory, "bridge-state.json");
  fs.writeFileSync(savedVariablesPath, source(), "utf8");

  const config = {
    holdfastUrl: "https://holdfast.example",
    telemetryEndpoint: "https://holdfast.example/api/bridge/telemetry",
    deviceToken: "gwd_secret",
    savedVariablesPath,
    wowRoot: null,
    pollIntervalMs: 1000,
    questSyncIntervalMs: Number.MAX_SAFE_INTEGER,
    statePath,
  };
  const requests = [];
  const logs = [];

  try {
    const result = await syncOnce(config, {
      log: (line) => logs.push(line),
      fetchImpl: async (url, options) => {
        const body = options?.body ? JSON.parse(options.body) : null;
        requests.push({ url, body });

        if (url.endsWith("/characters/snapshot") && body?.snapshot?.name === "Rook") {
          return new Response(JSON.stringify({ error: "unsupported_snapshot_schema" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ status: "accepted" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    assert.equal(result.discovered, 2);
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.telemetryDiscovered, 1);
    assert.equal(result.telemetrySent, 1);
    assert.match(logs.join("\n"), /realm:rook remains queued: .*unsupported_snapshot_schema/);
    assert.match(logs.join("\n"), /Synced Quill level 16 revision 4/);

    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const sentCharacterKeys = Object.keys(state.sentRevisions);
    assert.equal(sentCharacterKeys.length, 1);
    assert.match(sentCharacterKeys[0], /realm:quill$/);
    assert.equal(Object.values(state.sentRevisions)[0], 4);
    assert.equal(Object.values(state.sentTelemetryRevisions)[0], 15);

    assert.equal(
      requests.filter((request) => request.url.endsWith("/characters/snapshot")).length,
      2,
    );
    assert.equal(
      requests.filter((request) => request.url.endsWith("/api/bridge/telemetry")).length,
      1,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

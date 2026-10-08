import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncOnce } from "../src/sync.js";

function savedVariables() {
  return `GuildweaverDB = {
    ["schemaVersion"] = 4,
    ["sync"] = {
      ["outbound"] = {
        ["characters"] = {
          ["realm:rook"] = {
            ["revision"] = 7,
            ["payload"] = {
              ["schemaVersion"] = 3,
              ["name"] = "Rook",
              ["realm"] = "Realm",
              ["level"] = 30,
              ["race"] = { ["name"] = "Human" },
              ["class"] = { ["name"] = "Warrior" },
              ["professions"] = {},
              ["equipment"] = {},
            },
          },
        },
        ["telemetry"] = {
          ["talent_tree_definition:warrior"] = {
            ["kind"] = "state",
            ["revision"] = 4,
            ["fingerprint"] = "state-fingerprint",
            ["envelope"] = {
              ["schemaVersion"] = 1,
              ["eventType"] = "talent_tree_definition",
              ["capturedAt"] = 1790000000,
              ["payload"] = {
                ["schemaVersion"] = 4,
                ["treeId"] = 1117,
                ["nodes"] = {},
                ["edges"] = {},
              },
            },
          },
          ["loot_event:rook:1"] = {
            ["kind"] = "event",
            ["revision"] = 2,
            ["fingerprint"] = "event-fingerprint",
            ["envelope"] = {
              ["schemaVersion"] = 1,
              ["eventType"] = "loot_observation",
              ["capturedAt"] = 1790000001,
              ["payload"] = { ["itemId"] = 1234 },
            },
          },
        },
        ["questActions"] = {},
      },
    },
  }`;
}

test("reconciliation replays current character and state telemetry but not historical events", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-reconcile-"));
  const savedVariablesPath = path.join(directory, "Guildweaver.lua");
  const statePath = path.join(directory, "bridge-state.json");
  fs.writeFileSync(savedVariablesPath, savedVariables(), "utf8");

  const prefix = path.resolve(savedVariablesPath);
  fs.writeFileSync(
    statePath,
    `${JSON.stringify({
      sentRevisions: { [`${prefix}::realm:rook`]: 7 },
      sentTelemetryRevisions: {
        [`${prefix}::telemetry:talent_tree_definition:warrior`]: 4,
        [`${prefix}::telemetry:loot_event:rook:1`]: 2,
      },
      sentTelemetryFingerprints: {
        [`${prefix}::telemetry:talent_tree_definition:warrior`]: "state-fingerprint",
        [`${prefix}::telemetry:loot_event:rook:1`]: "event-fingerprint",
      },
      questActions: {},
      lastQuestSyncAt: 1000,
    })}\n`,
    "utf8",
  );

  const config = {
    holdfastUrl: "https://holdfast.example",
    telemetryEndpoint: "https://holdfast.example/api/bridge/telemetry",
    deviceToken: "gwd_secret",
    savedVariablesPath,
    wowRoot: null,
    pollIntervalMs: 3000,
    questSyncIntervalMs: Number.MAX_SAFE_INTEGER,
    statePath,
  };

  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ status: "duplicate" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const normal = await syncOnce(config, {
      fetchImpl,
      log: () => {},
      now: () => 1000,
    });
    assert.equal(normal.sent, 0);
    assert.equal(normal.telemetrySent, 0);
    assert.equal(requests.length, 0);

    const reconciled = await syncOnce(config, {
      fetchImpl,
      log: () => {},
      now: () => 1000,
      reconcileState: true,
    });

    assert.equal(reconciled.reconciledState, true);
    assert.equal(reconciled.sent, 1);
    assert.equal(reconciled.telemetrySent, 1);
    assert.equal(reconciled.telemetrySkipped, 1);
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0].url,
      "https://holdfast.example/api/bridge/characters/snapshot",
    );
    assert.equal(
      requests[1].url,
      "https://holdfast.example/api/bridge/telemetry",
    );

    const telemetryBody = JSON.parse(requests[1].options.body);
    assert.equal(telemetryBody.kind, "state");
    assert.equal(telemetryBody.streamKey, "talent_tree_definition:warrior");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

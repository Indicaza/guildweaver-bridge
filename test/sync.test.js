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

function savedVariablesWithTelemetry() {
  return `GuildweaverDB = {
    ["sync"] = {
      ["outbound"] = {
        ["characters"] = {
          ["realm:rook"] = {
            ["revision"] = 3,
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
        ["telemetry"] = {
          ["talent_tree_definition:warrior"] = {
            ["kind"] = "state",
            ["revision"] = 7,
            ["fingerprint"] = "stable-fingerprint",
            ["envelope"] = {
              ["schemaVersion"] = 1,
              ["eventType"] = "talent_tree_definition",
              ["capturedAt"] = 1791242820,
              ["characterId"] = "rook",
              ["payload"] = {
                ["schemaVersion"] = 3,
                ["treeId"] = 1117,
                ["nodes"] = {},
                ["edges"] = {},
              },
            },
          },
        },
      },
    },
  }`;
}

test("posts each outbound revision once with the paired device credential", async () => {
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
    const first = await syncOnce(config, { fetchImpl, log: () => {} });
    const second = await syncOnce(config, { fetchImpl, log: () => {} });

    assert.equal(first.sent, 1);
    assert.equal(second.sent, 0);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://holdfast.example/api/bridge/characters/snapshot",
    );
    assert.equal(requests[0].options.headers.Authorization, "Bearer gwd_secret");

    const body = JSON.parse(requests[0].options.body);
    assert.equal("memberId" in body, false);
    assert.equal(body.streamKey, "realm:rook");
    assert.equal(body.revision, 3);
    assert.equal(body.snapshot.name, "Rook");

    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(Object.values(state.sentRevisions)[0], 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("does not acknowledge a revision when the website rejects the device", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-bridge-"));
  const savedVariablesPath = path.join(directory, "Guildweaver.lua");
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(savedVariablesPath, savedVariables(), "utf8");

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
    await assert.rejects(
      syncOnce(config, {
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "invalid_device_token" }), {
            status: 401,
          }),
        log: () => {},
      }),
      /invalid_device_token/,
    );
    assert.equal(fs.existsSync(statePath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("replays locally acknowledged character and telemetry data when the server DB is missing it", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-bridge-"));
  const savedVariablesPath = path.join(directory, "Guildweaver.lua");
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(savedVariablesPath, savedVariablesWithTelemetry(), "utf8");

  const characterStateKey = `${path.resolve(savedVariablesPath)}::realm:rook`;
  const telemetryStateKey = `${path.resolve(savedVariablesPath)}::telemetry:talent_tree_definition:warrior`;
  fs.writeFileSync(
    statePath,
    `${JSON.stringify({
      sentRevisions: { [characterStateKey]: 3 },
      sentTelemetryRevisions: { [telemetryStateKey]: 7 },
      sentTelemetryFingerprints: { [telemetryStateKey]: "stable-fingerprint" },
      questActions: {},
      lastQuestSyncAt: 0,
      lastServerReconcileAt: 0,
    }, null, 2)}\n`,
    "utf8",
  );

  const config = {
    holdfastUrl: "https://holdfast.example",
    telemetryEndpoint: "https://holdfast.example/api/bridge/telemetry",
    deviceToken: "gwd_secret",
    savedVariablesPath,
    wowRoot: null,
    pollIntervalMs: 1000,
    reconcileIntervalMs: 5000,
    questSyncIntervalMs: Number.MAX_SAFE_INTEGER,
    statePath,
  };
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/api/bridge/sync-state")) {
      const manifest = JSON.parse(options.body);
      assert.deepEqual(manifest.characters, [{ streamKey: "realm:rook", revision: 3 }]);
      assert.deepEqual(manifest.telemetry, [
        { streamKey: "talent_tree_definition:warrior", revision: 7 },
      ]);
      return new Response(JSON.stringify({
        schemaVersion: 1,
        characters: [{
          streamKey: "realm:rook",
          revision: 3,
          serverRevision: 0,
          needsUpload: true,
        }],
        telemetry: [{
          streamKey: "talent_tree_definition:warrior",
          revision: 7,
          serverRevision: 0,
          needsUpload: true,
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ status: "created" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const first = await syncOnce(config, {
      fetchImpl,
      log: () => {},
      now: () => 10_000,
    });
    assert.equal(first.serverReconciled, true);
    assert.equal(first.sent, 1);
    assert.equal(first.telemetrySent, 1);
    assert.equal(requests.filter((request) => request.url.endsWith("/sync-state")).length, 1);
    assert.equal(requests.filter((request) => request.url.endsWith("/characters/snapshot")).length, 1);
    assert.equal(requests.filter((request) => request.url.endsWith("/telemetry")).length, 1);

    const snapshotBody = JSON.parse(
      requests.find((request) => request.url.endsWith("/characters/snapshot")).options.body,
    );
    assert.equal(snapshotBody.streamKey, "realm:rook");

    // Simulate the website DB being restored/emptied while the local bridge
    // cache still insists everything was already sent. The next reconciliation
    // must replay both durable datasets without requiring a new WoW revision.
    requests.length = 0;
    const second = await syncOnce(config, {
      fetchImpl,
      log: () => {},
      now: () => 20_000,
    });
    assert.equal(second.sent, 1);
    assert.equal(second.telemetrySent, 1);
    assert.equal(requests.filter((request) => request.url.endsWith("/characters/snapshot")).length, 1);
    assert.equal(requests.filter((request) => request.url.endsWith("/telemetry")).length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

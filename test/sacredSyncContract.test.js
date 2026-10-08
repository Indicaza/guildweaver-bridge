import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncOnce } from "../src/sync.js";

function ok(body = { status: "updated" }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function luaRecord({
  characterId = "character-rook-pc",
  installationId = "install-pc",
  reason = "PLAYER_LOGOUT",
  sectionStatus = "unavailable",
  revision = 7,
} = {}) {
  return `GuildweaverDB = {
    ["schemaVersion"] = 4,
    ["sync"] = {
      ["outbound"] = {
        ["characters"] = {
          ["classic beta pve 2:rook ravenstar"] = {
            ["revision"] = ${revision},
            ["payload"] = {
              ["schemaVersion"] = 3,
              ["capturedAt"] = 1791450000,
              ["installationId"] = "${installationId}",
              ["characterId"] = "${characterId}",
              ["characterKey"] = "classic beta pve 2:rook ravenstar",
              ["name"] = "Rook Ravenstar",
              ["realm"] = "Classic Beta PvE 2",
              ["region"] = "US",
              ["capture"] = {
                ["integrityVersion"] = 1,
                ["reason"] = "${reason}",
                ["sections"] = {
                  ["identity"] = "complete",
                  ["equipment"] = "${sectionStatus}",
                  ["talents"] = "${sectionStatus}",
                  ["professions"] = "${sectionStatus}",
                  ["recipes"] = "${sectionStatus}",
                },
              },
              ["equipment"] = {},
              ["professions"] = {},
              ["talents"] = {},
            },
          },
        },
        ["telemetry"] = {
          ["character_session:${characterId}:session:end"] = {
            ["kind"] = "event",
            ["revision"] = ${revision},
            ["fingerprint"] = "cafebabe",
            ["envelope"] = {
              ["schemaVersion"] = 1,
              ["eventType"] = "character_session_checkpoint",
              ["capturedAt"] = 1791450000,
              ["installationId"] = "${installationId}",
              ["characterId"] = "${characterId}",
              ["realm"] = "Classic Beta PvE 2",
              ["region"] = "US",
              ["payload"] = {
                ["schemaVersion"] = 3,
                ["installationId"] = "${installationId}",
                ["characterId"] = "${characterId}",
                ["name"] = "Rook Ravenstar",
                ["capture"] = {
                  ["integrityVersion"] = 1,
                  ["reason"] = "${reason}",
                  ["sections"] = { ["equipment"] = "${sectionStatus}" },
                },
              },
            },
          },
        },
      },
    },
  }`;
}

function configFor(directory, overrides = {}) {
  return {
    holdfastUrl: "https://holdfast.example",
    telemetryEndpoint: "https://holdfast.example/api/bridge/telemetry",
    deviceToken: "gwd_sacred",
    savedVariablesPath: null,
    wowRoot: null,
    pollIntervalMs: 3000,
    questSyncIntervalMs: Number.MAX_SAFE_INTEGER,
    statePath: path.join(directory, "state", "bridge-state.json"),
    ...overrides,
  };
}

test("preserves character identity and completeness metadata byte-for-byte across both transports", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-sacred-contract-"));
  const savedVariablesPath = path.join(directory, "Guildweaver.lua");
  fs.writeFileSync(savedVariablesPath, luaRecord(), "utf8");
  const config = configFor(directory, { savedVariablesPath });
  const requests = [];

  try {
    const result = await syncOnce(config, {
      fetchImpl: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return ok();
      },
      log: () => {},
    });

    assert.equal(result.sent, 1);
    assert.equal(result.telemetrySent, 1);
    assert.equal(requests.length, 2);

    const character = requests.find((entry) => entry.url.endsWith("/characters/snapshot"));
    const telemetry = requests.find((entry) => entry.url.endsWith("/telemetry"));
    assert.ok(character);
    assert.ok(telemetry);

    assert.equal(character.body.snapshot.characterId, "character-rook-pc");
    assert.equal(character.body.snapshot.installationId, "install-pc");
    assert.equal(character.body.snapshot.capture.integrityVersion, 1);
    assert.equal(character.body.snapshot.capture.reason, "PLAYER_LOGOUT");
    assert.equal(character.body.snapshot.capture.sections.equipment, "unavailable");
    assert.equal(character.body.snapshot.capture.sections.recipes, "unavailable");

    assert.equal(telemetry.body.envelope.characterId, "character-rook-pc");
    assert.equal(telemetry.body.envelope.installationId, "install-pc");
    assert.equal(telemetry.body.envelope.payload.characterId, "character-rook-pc");
    assert.equal(telemetry.body.envelope.payload.installationId, "install-pc");
    assert.equal(telemetry.body.envelope.payload.capture.sections.equipment, "unavailable");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SavedVariables files are independent delivery queues and can never dedupe each other by character key", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-sacred-multifile-"));
  const wowRoot = path.join(directory, "_classic_beta_");
  const accountRoot = path.join(wowRoot, "WTF", "Account");
  const pcPath = path.join(accountRoot, "PC", "SavedVariables", "Guildweaver.lua");
  const macPath = path.join(accountRoot, "MAC", "SavedVariables", "Guildweaver.lua");
  fs.mkdirSync(path.dirname(pcPath), { recursive: true });
  fs.mkdirSync(path.dirname(macPath), { recursive: true });
  fs.writeFileSync(pcPath, luaRecord({ characterId: "rook-pc", installationId: "install-pc", reason: "PLAYER_EQUIPMENT_CHANGED", sectionStatus: "complete" }), "utf8");
  fs.writeFileSync(macPath, luaRecord({ characterId: "rook-mac", installationId: "install-mac", reason: "PLAYER_ENTERING_WORLD", sectionStatus: "partial" }), "utf8");

  const config = configFor(directory, {
    wowRoot,
    telemetryEndpoint: null,
  });
  const snapshots = [];

  try {
    const first = await syncOnce(config, {
      fetchImpl: async (url, options) => {
        assert.ok(url.endsWith("/characters/snapshot"));
        snapshots.push(JSON.parse(options.body).snapshot);
        return ok();
      },
      log: () => {},
    });
    const second = await syncOnce(config, {
      fetchImpl: async () => {
        throw new Error("already delivered revisions must not be reposted");
      },
      log: () => {},
    });

    assert.equal(first.files, 2);
    assert.equal(first.sent, 2);
    assert.equal(second.sent, 0);
    assert.deepEqual(
      snapshots.map((entry) => entry.characterId).sort(),
      ["rook-mac", "rook-pc"],
    );
    assert.deepEqual(
      snapshots.map((entry) => entry.installationId).sort(),
      ["install-mac", "install-pc"],
    );

    const state = JSON.parse(fs.readFileSync(config.statePath, "utf8"));
    assert.equal(Object.keys(state.sentRevisions).length, 2);
    assert.ok(Object.keys(state.sentRevisions).some((key) => key.includes(path.resolve(pcPath))));
    assert.ok(Object.keys(state.sentRevisions).some((key) => key.includes(path.resolve(macPath))));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

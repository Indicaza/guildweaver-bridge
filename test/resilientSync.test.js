import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncOnce } from "../src/sync.js";

function stream(eventType, characterId, name, revision, fingerprint) {
  return `["${eventType}:${characterId}"] = {
            ["kind"] = "state",
            ["revision"] = ${revision},
            ["fingerprint"] = "${fingerprint}",
            ["envelope"] = {
              ["schemaVersion"] = 1,
              ["eventType"] = "${eventType}",
              ["capturedAt"] = 1791320496,
              ["characterId"] = "${characterId}",
              ["realm"] = "Classic Beta PvE 2",
              ["payload"] = {
                ["schemaVersion"] = 1,
                ["name"] = "${name}",
                ["realm"] = "Classic Beta PvE 2",
              },
            },
          },`;
}

function source() {
  return `GuildweaverDB = {
    ["schemaVersion"] = 4,
    ["sync"] = {
      ["outbound"] = {
        ["telemetry"] = {
          ${stream("character", "character-rook", "Rook", 15, "abcdef12")}
          ${stream("character", "character-quill", "Quill", 4, "12abcdef")}
        },
      },
    },
  }`;
}

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-resilient-sync-"));
  const savedVariablesPath = path.join(directory, "Guildweaver.lua");
  const statePath = path.join(directory, "bridge-state.json");
  fs.writeFileSync(savedVariablesPath, source(), "utf8");
  return {
    directory,
    statePath,
    config: {
      holdfastUrl: "https://holdfast.example",
      telemetryEndpoint: "https://holdfast.example/api/bridge/telemetry",
      deviceToken: "gwd_secret",
      savedVariablesPath,
      wowRoot: null,
      pollIntervalMs: 1000,
      questSyncIntervalMs: Number.MAX_SAFE_INTEGER,
      statePath,
    },
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("one rejected telemetry record does not block the others", async () => {
  const { directory, statePath, config } = setup();
  const requests = [];
  const logs = [];

  try {
    const result = await syncOnce(config, {
      log: (line) => logs.push(line),
      fetchImpl: async (url, options) => {
        const body = options?.body ? JSON.parse(options.body) : null;
        requests.push({ url, body });
        return body?.envelope?.payload?.name === "Rook"
          ? json({ error: "invalid_telemetry_record" }, 400)
          : json({ status: "created" });
      },
    });

    assert.equal(result.telemetryDiscovered, 2);
    assert.equal(result.telemetrySent, 1);
    assert.equal(result.telemetryFailed, 1);
    assert.match(logs.join("\n"), /invalid_telemetry_record/);

    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const sent = Object.keys(state.sentTelemetryRevisions);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /character:character-quill$/);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.url.endsWith("/api/bridge/telemetry")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a rejected device stops the sync without acknowledging anything", async () => {
  const { directory, statePath, config } = setup();

  try {
    await assert.rejects(
      syncOnce(config, {
        fetchImpl: async () => json({ error: "invalid_device_token" }, 401),
        log: () => {},
      }),
      /invalid_device_token/,
    );
    assert.equal(fs.existsSync(statePath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

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

function telemetryStream(streamKey, { kind = "state", revision = 1, eventType, characterId, value = 1 }) {
  return `["${streamKey}"] = {
            ["kind"] = "${kind}",
            ["revision"] = ${revision},
            ["envelope"] = {
              ["schemaVersion"] = 1,
              ["eventType"] = "${eventType}",
              ["capturedAt"] = 1791320496,
              ${characterId ? `["characterId"] = "${characterId}",` : ""}
              ["payload"] = { ["schemaVersion"] = 1, ["value"] = ${value} },
            },
          },`;
}

function telemetrySavedVariables(streams) {
  return `GuildweaverDB = {
    ["schemaVersion"] = 4,
    ["sync"] = {
      ["outbound"] = {
        ["telemetry"] = {
          ${streams.join("\n          ")}
        },
      },
    },
  }`;
}

function telemetrySetup(streams) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-sync-"));
  const savedVariablesPath = path.join(directory, "Guildweaver.lua");
  const statePath = path.join(directory, "bridge-state.json");
  fs.writeFileSync(savedVariablesPath, telemetrySavedVariables(streams), "utf8");

  return {
    directory,
    savedVariablesPath,
    statePath,
    fileCache: new Map(),
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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Counts fs calls made by sync.js, which shares this default fs export.
function spyOn(method, matches) {
  const original = fs[method];
  const calls = [];
  fs[method] = (...args) => {
    if (matches(String(args[0]))) calls.push(args);
    return original.apply(fs, args);
  };
  return { calls, restore: () => (fs[method] = original) };
}

function bumpMtime(filePath) {
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(filePath, future, future);
}

test("skips parsing a SavedVariables file whose mtime and size are unchanged", async () => {
  const streams = [telemetryStream("character:c1", { eventType: "character", characterId: "c1" })];
  const { directory, savedVariablesPath, fileCache, config } = telemetrySetup(streams);
  const reads = spyOn("readFileSync", (file) => file === savedVariablesPath);
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return jsonResponse({ status: "created" });
  };
  const sync = (options = {}) => syncOnce(config, { fetchImpl, log: () => {}, fileCache, ...options });

  try {
    const first = await sync();
    assert.equal(first.telemetrySent, 1);
    assert.equal(reads.calls.length, 1);

    const idle = await sync();
    assert.equal(reads.calls.length, 1, "unchanged file is not re-read");
    assert.equal(idle.unchangedFiles, 1);
    assert.equal(idle.telemetryDiscovered, 1);
    assert.equal(idle.telemetrySkipped, 1);

    const reconciled = await sync({ reconcileState: true });
    assert.equal(reads.calls.length, 2, "reconcile re-reads unchanged files");
    assert.equal(reconciled.telemetrySent, 1);

    fs.writeFileSync(
      savedVariablesPath,
      telemetrySavedVariables([
        telemetryStream("character:c1", { eventType: "character", characterId: "c1", revision: 2, value: 22 }),
      ]),
      "utf8",
    );
    bumpMtime(savedVariablesPath);
    const changed = await sync();
    assert.equal(reads.calls.length, 3, "a changed file is parsed again");
    assert.equal(changed.telemetrySent, 1);
    assert.equal(requests.at(-1).revision, 2);
  } finally {
    reads.restore();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps re-reading a file while it still has telemetry queued", async () => {
  const streams = [telemetryStream("character:c1", { eventType: "character", characterId: "c1" })];
  const { directory, savedVariablesPath, fileCache, config } = telemetrySetup(streams);
  const reads = spyOn("readFileSync", (file) => file === savedVariablesPath);
  let status = 503;
  const fetchImpl = async () => jsonResponse(status === 200 ? { status: "created" } : { error: "down" }, status);
  const sync = () => syncOnce(config, { fetchImpl, log: () => {}, fileCache });

  try {
    assert.equal((await sync()).telemetryFailed, 1);
    assert.equal((await sync()).telemetryFailed, 1);
    assert.equal(reads.calls.length, 2, "queued work keeps the file live");

    status = 200;
    assert.equal((await sync()).telemetrySent, 1);
    await sync();
    assert.equal(reads.calls.length, 3);
  } finally {
    reads.restore();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("holds permanently rejected telemetry until its content changes", async () => {
  const bad = (value) =>
    telemetryStream("item_definition:1", { eventType: "item_definition", value });
  const { directory, savedVariablesPath, statePath, fileCache, config } = telemetrySetup([bad(1)]);
  const logs = [];
  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return body.envelope.payload.value === 1
      ? jsonResponse({ error: "invalid_telemetry_record" }, 400)
      : jsonResponse({ status: "created" });
  };
  const sync = (options = {}) =>
    syncOnce(config, { fetchImpl, log: (line) => logs.push(line), fileCache, ...options });

  try {
    const first = await sync();
    assert.equal(first.telemetryRejected, 1);
    assert.equal(requests.length, 1);

    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const [rejection] = Object.values(state.rejectedTelemetry);
    assert.equal(rejection.status, 400);
    assert.equal(rejection.error, "invalid_telemetry_record");
    assert.equal(Object.keys(state.sentTelemetryRevisions).length, 0);

    // Touched but identical content: parsed again, but not re-posted.
    bumpMtime(savedVariablesPath);
    const touched = await sync();
    assert.equal(touched.telemetrySkipped, 1);
    assert.equal(requests.length, 1);

    // Reconcile retries once in case the server was fixed; no repeat log.
    await sync({ reconcileState: true });
    assert.equal(requests.length, 2);
    assert.equal(logs.filter((line) => /rejected/.test(line)).length, 1, "rejection is logged once");

    fs.writeFileSync(savedVariablesPath, telemetrySavedVariables([bad(2)]), "utf8");
    bumpMtime(savedVariablesPath);
    const fixed = await sync();
    assert.equal(fixed.telemetrySent, 1);
    assert.equal(requests.length, 3);
    const after = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.deepEqual(after.rejectedTelemetry, {});
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("retries transient statuses (408, 429, 5xx) every pass", async () => {
  for (const status of [408, 429, 500]) {
    const streams = [telemetryStream("character:c1", { eventType: "character", characterId: "c1" })];
    const { directory, savedVariablesPath, fileCache, config } = telemetrySetup(streams);
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      return jsonResponse({ error: "busy" }, status);
    };

    try {
      const result = await syncOnce(config, { fetchImpl, log: () => {}, fileCache });
      assert.equal(result.telemetryRejected, 0, `HTTP ${status} is transient`);
      bumpMtime(savedVariablesPath);
      await syncOnce(config, { fetchImpl, log: () => {}, fileCache });
      assert.equal(requests, 2, `HTTP ${status} is retried`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("writes bridge state once per file pass and prunes vanished streams", async () => {
  const streams = [1, 2, 3].map((n) =>
    telemetryStream(`loot:${n}`, { kind: "event", eventType: "mob_loot", characterId: "c1", value: n }),
  );
  const { directory, savedVariablesPath, statePath, fileCache, config } = telemetrySetup(streams);
  const writes = spyOn("writeFileSync", (file) => file === `${statePath}.tmp`);
  const fetchImpl = async () => jsonResponse({ status: "created" });

  try {
    const prefix = `${path.resolve(savedVariablesPath)}::telemetry:`;
    const otherFile = `${path.resolve(directory, "Other.lua")}::telemetry:loot:9`;
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        sentTelemetryRevisions: { [`${prefix}loot:old`]: 1, [otherFile]: 1 },
        sentTelemetryFingerprints: { [`${prefix}loot:old`]: "x" },
        rejectedTelemetry: { [`${prefix}gone:1`]: { fingerprint: "y" } },
      }),
    );

    const result = await syncOnce(config, { fetchImpl, log: () => {}, fileCache });
    assert.equal(result.telemetrySent, 3);
    assert.equal(writes.calls.length, 1, "one state write for three records");

    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.deepEqual(Object.keys(state.sentTelemetryRevisions).sort(), [
      otherFile,
      `${prefix}loot:1`,
      `${prefix}loot:2`,
      `${prefix}loot:3`,
    ].sort(), "other files' keys are left alone");
    assert.equal(state.sentTelemetryFingerprints[`${prefix}loot:old`], undefined);
    assert.deepEqual(state.rejectedTelemetry, {});

    fs.writeFileSync(savedVariablesPath, telemetrySavedVariables(streams.slice(2)), "utf8");
    bumpMtime(savedVariablesPath);
    await syncOnce(config, { fetchImpl, log: () => {}, fileCache });
    const pruned = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.deepEqual(Object.keys(pruned.sentTelemetryRevisions).sort(), [otherFile, `${prefix}loot:3`].sort());

    bumpMtime(savedVariablesPath);
    await syncOnce(config, { fetchImpl, log: () => {}, fileCache });
    assert.equal(writes.calls.length, 2, "a pass with nothing new does not rewrite state");
  } finally {
    writes.restore();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reconcile replays character state but not item or game item definitions", async () => {
  const streams = [
    telemetryStream("character:c1", { eventType: "character", characterId: "c1" }),
    telemetryStream("item_definition:1", { eventType: "item_definition", characterId: "c1" }),
    telemetryStream("game_item_definition:2589", { eventType: "game_item_definition" }),
    telemetryStream("guild:g1", { eventType: "guild_roster" }),
  ];
  const { directory, fileCache, config } = telemetrySetup(streams);
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(JSON.parse(options.body).streamKey);
    return jsonResponse({ status: "created" });
  };

  try {
    await syncOnce(config, { fetchImpl, log: () => {}, fileCache });
    assert.equal(requests.length, 4);
    requests.length = 0;

    await syncOnce(config, { fetchImpl, log: () => {}, fileCache, reconcileState: true });
    assert.deepEqual(requests, ["character:c1"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

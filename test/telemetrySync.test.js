import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncOnce } from "../src/sync.js";

function fixtureSource() {
  return fs.readFileSync(
    new URL("../fixtures/savedvariables/schema4.lua", import.meta.url),
    "utf8",
  );
}

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver telemetry "));
  const accountDirectory = path.join(directory, "Account With Spaces", "SavedVariables");
  fs.mkdirSync(accountDirectory, { recursive: true });
  const savedVariablesPath = path.join(accountDirectory, "Guildweaver.lua");
  const statePath = path.join(directory, "state", "bridge-state.json");
  fs.writeFileSync(savedVariablesPath, fixtureSource(), "utf8");

  return {
    directory,
    config: {
      holdfastUrl: "https://holdfast.example",
      telemetryEndpoint: "https://collector.example/v1/telemetry",
      deviceToken: "gwd_secret",
      savedVariablesPath,
      wowRoot: null,
      pollIntervalMs: 3000,
      questSyncIntervalMs: Number.MAX_SAFE_INTEGER,
      statePath,
    },
  };
}

function ok(body = { status: "accepted" }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("sends generic telemetry once with an idempotency key across paths with spaces", async () => {
  const { directory, config } = setup();
  const requests = [];

  try {
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      return ok();
    };

    const first = await syncOnce(config, { fetchImpl, log: () => {} });
    const second = await syncOnce(config, { fetchImpl, log: () => {} });

    assert.equal(first.telemetryDiscovered, 1);
    assert.equal(first.telemetrySent, 1);
    assert.equal(first.telemetryFailed, 0);
    assert.equal(second.telemetrySent, 0);
    assert.equal(second.telemetrySkipped, 1);
    assert.equal(requests.length, 1, "the retired character mailbox is never posted");

    const telemetryRequest = requests.find(
      (request) => request.url === "https://collector.example/v1/telemetry",
    );
    assert.ok(telemetryRequest);
    assert.equal(telemetryRequest.options.headers.Authorization, "Bearer gwd_secret");
    assert.match(telemetryRequest.options.headers["Idempotency-Key"], /^gw-[a-f0-9]{64}$/);

    const body = JSON.parse(telemetryRequest.options.body);
    assert.equal(body.streamKey, "character_snapshot:character-fixture");
    assert.equal(body.revision, 3);
    assert.equal(body.envelope.eventType, "character_snapshot");
    assert.equal(body.envelope.payload.name, "Rook");

    const state = JSON.parse(fs.readFileSync(config.statePath, "utf8"));
    assert.equal(Object.values(state.sentTelemetryRevisions)[0], 3);
    assert.equal(Object.values(state.sentTelemetryFingerprints)[0], "09def876");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("acknowledges a newer state revision without reposting an unchanged fingerprint", async () => {
  const { directory, config } = setup();
  const telemetryKey = `${path.resolve(config.savedVariablesPath)}::telemetry:character_snapshot:character-fixture`;
  fs.mkdirSync(path.dirname(config.statePath), { recursive: true });
  fs.writeFileSync(
    config.statePath,
    JSON.stringify({
      sentTelemetryRevisions: { [telemetryKey]: 2 },
      sentTelemetryFingerprints: { [telemetryKey]: "09def876" },
      questActions: {},
      lastQuestSyncAt: 0,
    }),
    "utf8",
  );
  const requests = [];

  try {
    const result = await syncOnce(config, {
      fetchImpl: async (url) => {
        requests.push(url);
        return ok();
      },
      log: () => {},
    });

    assert.equal(result.telemetrySent, 0);
    assert.equal(result.telemetrySkipped, 1);
    assert.deepEqual(requests, []);

    const state = JSON.parse(fs.readFileSync(config.statePath, "utf8"));
    assert.equal(state.sentTelemetryRevisions[telemetryKey], 3);
    assert.equal(state.sentTelemetryFingerprints[telemetryKey], "09def876");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps telemetry queued while offline and never posts the retired character mailbox", async () => {
  const { directory, config } = setup();
  let telemetryOnline = false;
  let legacyPosts = 0;
  let telemetryPosts = 0;

  try {
    const fetchImpl = async (url) => {
      if (url.includes("characters/snapshot")) {
        legacyPosts += 1;
        return ok({ status: "updated" });
      }

      telemetryPosts += 1;
      if (!telemetryOnline) {
        return new Response(JSON.stringify({ error: "offline" }), { status: 503 });
      }
      return ok();
    };

    const first = await syncOnce(config, { fetchImpl, log: () => {} });
    assert.equal(first.telemetrySent, 0);
    assert.equal(first.telemetryFailed, 1);
    assert.equal(legacyPosts, 0);
    assert.equal(telemetryPosts, 1);
    assert.equal(fs.existsSync(config.statePath), false, "nothing acknowledged while offline");

    let state;

    telemetryOnline = true;
    const second = await syncOnce(config, { fetchImpl, log: () => {} });
    assert.equal(second.telemetrySent, 1);
    assert.equal(legacyPosts, 0);
    assert.equal(telemetryPosts, 2);

    state = JSON.parse(fs.readFileSync(config.statePath, "utf8"));
    assert.equal(Object.values(state.sentTelemetryRevisions)[0], 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("defers the generic outbox without acknowledging it when no ingestion endpoint exists", async () => {
  const { directory, config } = setup();
  config.telemetryEndpoint = null;
  const requests = [];

  try {
    const result = await syncOnce(config, {
      fetchImpl: async (url) => {
        requests.push(url);
        return ok({ status: "updated" });
      },
      log: () => {},
    });

    assert.equal(result.telemetryDiscovered, 1);
    assert.equal(result.telemetryDeferred, 1);
    assert.equal(result.telemetrySent, 0);
    assert.deepEqual(requests, []);
    assert.equal(fs.existsSync(config.statePath), false, "the deferred outbox is not acknowledged");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
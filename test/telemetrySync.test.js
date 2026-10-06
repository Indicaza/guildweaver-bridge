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
      return ok(url.includes("characters/snapshot") ? { status: "updated" } : undefined);
    };

    const first = await syncOnce(config, { fetchImpl, log: () => {} });
    const second = await syncOnce(config, { fetchImpl, log: () => {} });

    assert.equal(first.sent, 1);
    assert.equal(first.telemetryDiscovered, 1);
    assert.equal(first.telemetrySent, 1);
    assert.equal(first.telemetryFailed, 0);
    assert.equal(second.sent, 0);
    assert.equal(second.telemetrySent, 0);
    assert.equal(second.telemetrySkipped, 1);
    assert.equal(requests.length, 2);

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
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("prefers an independent collector credential without changing Holdfast auth", async () => {
  const { directory, config } = setup();
  config.telemetryToken = "collector_secret";
  const requests = [];

  try {
    const result = await syncOnce(config, {
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return ok(url.includes("characters/snapshot") ? { status: "updated" } : undefined);
      },
      log: () => {},
    });

    assert.equal(result.sent, 1);
    assert.equal(result.telemetrySent, 1);

    const holdfast = requests.find((request) => request.url.includes("characters/snapshot"));
    const collector = requests.find(
      (request) => request.url === "https://collector.example/v1/telemetry",
    );
    assert.equal(holdfast.options.headers.Authorization, "Bearer gwd_secret");
    assert.equal(collector.options.headers.Authorization, "Bearer collector_secret");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("collector-only mode sends telemetry without any Holdfast credential or request", async () => {
  const { directory, config } = setup();
  config.holdfastEnabled = false;
  config.deviceToken = null;
  config.telemetryToken = "collector_secret";
  const requests = [];

  try {
    const result = await syncOnce(config, {
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return ok();
      },
      log: () => {},
    });

    assert.equal(result.discovered, 0);
    assert.equal(result.sent, 0);
    assert.equal(result.questActionsDiscovered, 0);
    assert.equal(result.questActionsSent, 0);
    assert.equal(result.questSnapshotUpdated, false);
    assert.equal(result.telemetryDiscovered, 1);
    assert.equal(result.telemetrySent, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://collector.example/v1/telemetry");
    assert.equal(requests[0].options.headers.Authorization, "Bearer collector_secret");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("collector-only mode keeps telemetry queued when its credential is unavailable", async () => {
  const { directory, config } = setup();
  config.holdfastEnabled = false;
  config.deviceToken = null;
  config.telemetryToken = null;
  const requests = [];

  try {
    const result = await syncOnce(config, {
      fetchImpl: async (...args) => {
        requests.push(args);
        return ok();
      },
      log: () => {},
    });

    assert.equal(result.telemetrySent, 0);
    assert.equal(result.telemetryFailed, 1);
    assert.equal(requests.length, 0);

    const stateExists = fs.existsSync(config.statePath);
    if (stateExists) {
      const state = JSON.parse(fs.readFileSync(config.statePath, "utf8"));
      assert.equal(Object.keys(state.sentTelemetryRevisions).length, 0);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps telemetry queued while offline and retries without duplicating legacy character delivery", async () => {
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
    assert.equal(first.sent, 1);
    assert.equal(first.telemetrySent, 0);
    assert.equal(first.telemetryFailed, 1);
    assert.equal(legacyPosts, 1);
    assert.equal(telemetryPosts, 1);

    let state = JSON.parse(fs.readFileSync(config.statePath, "utf8"));
    assert.equal(Object.keys(state.sentTelemetryRevisions).length, 0);

    telemetryOnline = true;
    const second = await syncOnce(config, { fetchImpl, log: () => {} });
    assert.equal(second.sent, 0);
    assert.equal(second.telemetrySent, 1);
    assert.equal(legacyPosts, 1);
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
    assert.deepEqual(requests, ["https://holdfast.example/api/bridge/characters/snapshot"]);

    const state = JSON.parse(fs.readFileSync(config.statePath, "utf8"));
    assert.equal(Object.keys(state.sentTelemetryRevisions).length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

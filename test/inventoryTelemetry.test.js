import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncOnce } from "../src/sync.js";
import {
  normalizeTelemetryRecord,
  telemetryIdempotencyKey,
  telemetryTransportBody,
} from "../src/telemetry.js";

// inventory_snapshot is just another telemetry stream to the bridge: these
// tests pin that it is validated, deduped, revision-tracked, and retried
// without the bridge reinterpreting bag, item, or money data.

const envelope = JSON.parse(
  fs.readFileSync(new URL("../fixtures/telemetry/inventory_snapshot.v1.json", import.meta.url), "utf8"),
);

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver inventory "));
  const accountDirectory = path.join(directory, "SavedVariables");
  fs.mkdirSync(accountDirectory, { recursive: true });
  const savedVariablesPath = path.join(accountDirectory, "Guildweaver.lua");
  fs.copyFileSync(
    new URL("../fixtures/savedvariables/inventory_snapshot.lua", import.meta.url),
    savedVariablesPath,
  );
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
      statePath: path.join(directory, "state", "bridge-state.json"),
    },
  };
}

test("passes inventory_snapshot through as opaque payload data", () => {
  const record = normalizeTelemetryRecord("inventory_snapshot:character-fixture", {
    kind: "state",
    revision: 3,
    envelope,
  });

  assert.equal(record.envelope.eventType, "inventory_snapshot");
  assert.equal(record.envelope.payloadSchemaVersion, 1);
  assert.deepEqual(record.envelope.payload, envelope.payload);
  assert.deepEqual(telemetryTransportBody(record).envelope.payload, envelope.payload);

  const nextRevision = normalizeTelemetryRecord("inventory_snapshot:character-fixture", {
    kind: "state",
    revision: 4,
    envelope,
  });
  assert.notEqual(telemetryIdempotencyKey(record), telemetryIdempotencyKey(nextRevision));
});

test("rejects a inventory_snapshot envelope whose payload is not an object", () => {
  assert.throws(
    () =>
      normalizeTelemetryRecord("inventory_snapshot:character-fixture", {
        kind: "state",
        revision: 1,
        envelope: { ...envelope, payload: [] },
      }),
    /payload must be an object/,
  );
});

test("delivers inventory_snapshot once, retries while offline, and keeps the payload intact", async () => {
  const { directory, config } = setup();
  const bodies = [];
  let online = false;

  try {
    const fetchImpl = async (url, options) => {
      if (url !== config.telemetryEndpoint) {
        return new Response(JSON.stringify({ status: "unchanged" }), { status: 200 });
      }
      bodies.push(JSON.parse(options.body));
      if (!online) {
        return new Response(JSON.stringify({ error: "offline" }), { status: 503 });
      }
      return new Response(JSON.stringify({ status: "accepted" }), { status: 200 });
    };

    const offline = await syncOnce(config, { fetchImpl, log: () => {} });
    assert.equal(offline.telemetryDiscovered, 1);
    assert.equal(offline.telemetryFailed, 1);

    online = true;
    const delivered = await syncOnce(config, { fetchImpl, log: () => {} });
    assert.equal(delivered.telemetrySent, 1);

    const repeat = await syncOnce(config, { fetchImpl, log: () => {} });
    assert.equal(repeat.telemetrySent, 0);
    assert.equal(repeat.telemetrySkipped, 1);

    assert.equal(bodies.length, 2, "one failed attempt and one delivery");
    const body = bodies.at(-1);
    assert.equal(body.streamKey, "inventory_snapshot:character-fixture");
    assert.equal(body.revision, 3);
    assert.deepEqual(body.envelope.payload, envelope.payload);
    assert.equal(body.envelope.payload.money.copper, 1234567);
    assert.equal(body.envelope.payload.containers[0].slots[1].itemKey, "item:2770::::::::20:::::::");
    assert.equal(body.envelope.payload.totals[1].count, 25);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("forwards an empty bag's slots exactly as the SavedVariables parser reads them", async () => {
  const { directory, config } = setup();
  const bodies = [];
  try {
    const source = fs.readFileSync(config.savedVariablesPath, "utf8");
    // An empty Lua table is indistinguishable from an empty object; the bridge
    // must not coerce it either way.
    const start = source.indexOf('["slots"] = {');
    const close = "\n                  }";
    const end = source.indexOf(close + ",", start);
    fs.writeFileSync(config.savedVariablesPath, `${source.slice(0, start)}["slots"] = {}${source.slice(end + close.length)}`);
    const fetchImpl = async (url, options) => {
      if (url === config.telemetryEndpoint) bodies.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ status: "accepted" }), { status: 200 });
    };
    const result = await syncOnce(config, { fetchImpl, log: () => {} });
    assert.equal(result.telemetrySent, 1);
    assert.deepEqual(bodies[0].envelope.payload.containers[0].slots, {});
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("resends a stream whose revision counter was reset with new content", async () => {
  const { directory, config } = setup();
  const bodies = [];
  try {
    const fetchImpl = async (url, options) => {
      if (url === config.telemetryEndpoint) bodies.push({ body: JSON.parse(options.body), key: options.headers["Idempotency-Key"] });
      return new Response(JSON.stringify({ status: "accepted" }), { status: 200 });
    };
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 1);

    // The addon's SavedVariables were wiped: the stream restarts at revision 1
    // with different contents.
    const source = fs.readFileSync(config.savedVariablesPath, "utf8")
      .replace('["revision"] = 3', '["revision"] = 1')
      .replace('["fingerprint"] = "9c41d2e0"', '["fingerprint"] = "0badf00d"')
      .replace('["copper"] = 1234567', '["copper"] = 7654321');
    fs.writeFileSync(config.savedVariablesPath, source);

    const afterReset = await syncOnce(config, { fetchImpl, log: () => {} });
    assert.equal(afterReset.telemetrySent, 1, "new content at an old revision is sent");
    assert.equal(bodies.at(-1).body.revision, 1);
    assert.equal(bodies.at(-1).body.envelope.payload.money.copper, 7654321);
    assert.notEqual(bodies.at(-1).key, bodies[0].key, "a distinct idempotency key");

    const again = await syncOnce(config, { fetchImpl, log: () => {} });
    assert.equal(again.telemetrySent, 0, "and only once");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

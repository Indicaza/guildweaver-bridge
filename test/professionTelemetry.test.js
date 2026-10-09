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

// profession_snapshot is just another telemetry stream to the bridge: these
// tests pin that it is validated, deduped, revision-tracked, and retried
// without the bridge reinterpreting profession data.

const envelope = JSON.parse(
  fs.readFileSync(new URL("../fixtures/telemetry/profession_snapshot.v1.json", import.meta.url), "utf8"),
);

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver professions "));
  const accountDirectory = path.join(directory, "SavedVariables");
  fs.mkdirSync(accountDirectory, { recursive: true });
  const savedVariablesPath = path.join(accountDirectory, "Guildweaver.lua");
  fs.copyFileSync(
    new URL("../fixtures/savedvariables/profession_snapshot.lua", import.meta.url),
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

test("passes profession_snapshot through as opaque payload data", () => {
  const record = normalizeTelemetryRecord("profession_snapshot:character-fixture", {
    kind: "state",
    revision: 2,
    envelope,
  });

  assert.equal(record.envelope.eventType, "profession_snapshot");
  assert.equal(record.envelope.payloadSchemaVersion, 1);
  assert.deepEqual(record.envelope.payload, envelope.payload);
  assert.deepEqual(telemetryTransportBody(record).envelope.payload, envelope.payload);

  const nextRevision = normalizeTelemetryRecord("profession_snapshot:character-fixture", {
    kind: "state",
    revision: 3,
    envelope,
  });
  assert.notEqual(telemetryIdempotencyKey(record), telemetryIdempotencyKey(nextRevision));
});

test("rejects a profession_snapshot envelope whose payload is not an object", () => {
  assert.throws(
    () =>
      normalizeTelemetryRecord("profession_snapshot:character-fixture", {
        kind: "state",
        revision: 1,
        envelope: { ...envelope, payload: [] },
      }),
    /payload must be an object/,
  );
});

test("delivers profession_snapshot once, retries while offline, and keeps the payload intact", async () => {
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
    assert.equal(body.streamKey, "profession_snapshot:character-fixture");
    assert.equal(body.revision, 2);
    assert.deepEqual(body.envelope.payload, envelope.payload);
    assert.equal(body.envelope.payload.professions[0].recipes[0].reagents[0].itemId, 2835);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

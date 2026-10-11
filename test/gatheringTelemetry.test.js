import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  normalizeTelemetryRecord,
  telemetryTransportBody,
} from "../src/telemetry.js";

const envelope = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/telemetry/gathering_loot.v1.json", import.meta.url),
    "utf8",
  ),
);

test("passes herbalism gathering observations through unchanged as event telemetry", () => {
  const streamKey = "gathering_loot:character-rook:fixture-herb-1";
  const record = normalizeTelemetryRecord(streamKey, {
    kind: "event",
    revision: 1,
    updatedAt: envelope.capturedAt,
    envelope,
  });

  assert.equal(record.kind, "event");
  assert.equal(record.envelope.eventType, "gathering_loot");
  assert.equal(record.envelope.payload.discipline, "herbalism");
  assert.equal(record.envelope.payload.source.name, "Peacebloom");
  assert.equal(record.envelope.payload.source.objectId, 1618);
  assert.equal(record.envelope.payload.outputs[1].itemId, 249399);
  assert.equal(record.envelope.payload.context.profession.skillLevel, 87);
  assert.equal(record.envelope.payload.context.modifiers.bountifulHarvest.rank, 3);
  assert.deepEqual(record.envelope.payload, envelope.payload);

  assert.deepEqual(telemetryTransportBody(record), {
    streamKey,
    kind: "event",
    revision: 1,
    envelope: record.envelope,
  });
});

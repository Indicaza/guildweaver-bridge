import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  normalizeTelemetryRecord,
  telemetryIdempotencyKey,
  telemetryTransportBody,
} from "../src/telemetry.js";

const envelope = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/telemetry/character_snapshot.v1.json", import.meta.url),
    "utf8",
  ),
);

const professionEnvelope = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/telemetry/profession_snapshot.v1.json", import.meta.url),
    "utf8",
  ),
);

const inventoryEnvelope = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/telemetry/inventory_snapshot.v1.json", import.meta.url),
    "utf8",
  ),
);

const auctionEnvelope = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/telemetry/auction_observation.v1.json", import.meta.url),
    "utf8",
  ),
);

const collectorHealthEnvelope = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/telemetry/collector_health_snapshot.v1.json", import.meta.url),
    "utf8",
  ),
);

test("normalizes the shared character telemetry fixture", () => {
  const record = normalizeTelemetryRecord("character_snapshot:fixture", {
    revision: 4,
    updatedAt: envelope.capturedAt,
    envelope,
  });

  assert.equal(record.revision, 4);
  assert.equal(record.envelope.schemaVersion, 1);
  assert.equal(record.envelope.eventType, "character_snapshot");
  assert.equal(record.envelope.payload.name, "Rook");
  assert.equal(record.envelope.payload.equipment[0].itemId, 5191);
  assert.equal(record.envelope.payload.professions[0].recipes[0].id, 1001);

  const body = telemetryTransportBody(record);
  assert.equal(body.streamKey, "character_snapshot:fixture");
  assert.equal(body.revision, 4);
  assert.deepEqual(body.envelope, record.envelope);
});

test("passes profession state streams through the generic transport unchanged", () => {
  const record = normalizeTelemetryRecord("profession_snapshot:fixture", {
    revision: 2,
    updatedAt: professionEnvelope.capturedAt,
    envelope: professionEnvelope,
  });

  assert.equal(record.envelope.eventType, "profession_snapshot");
  assert.equal(record.envelope.payload.professions.length, 2);
  assert.equal(record.envelope.payload.professions[0].name, "Alchemy");
  assert.equal(record.envelope.payload.professions[0].skillLevel, 150);
  assert.equal(record.envelope.payload.professions[0].knownRecipeCount, 2);

  const body = telemetryTransportBody(record);
  assert.equal(body.streamKey, "profession_snapshot:fixture");
  assert.deepEqual(body.envelope.payload, professionEnvelope.payload);
});

test("passes carried inventory state through the generic transport unchanged", () => {
  const record = normalizeTelemetryRecord("inventory_snapshot:fixture", {
    revision: 3,
    updatedAt: inventoryEnvelope.capturedAt,
    envelope: inventoryEnvelope,
  });

  assert.equal(record.envelope.eventType, "inventory_snapshot");
  assert.equal(record.envelope.payload.scope, "carried_bags");
  assert.equal(record.envelope.payload.items.length, 2);
  assert.equal(record.envelope.payload.items[1].itemId, 2840);
  assert.equal(record.envelope.payload.items[1].count, 11);
  assert.equal(record.envelope.payload.items[1].boundCount, 3);
  assert.deepEqual(record.envelope.payload.excludes, [
    "gold",
    "bank",
    "mail",
    "auction_house",
  ]);

  const body = telemetryTransportBody(record);
  assert.equal(body.streamKey, "inventory_snapshot:fixture");
  assert.deepEqual(body.envelope.payload, inventoryEnvelope.payload);
});

test("passes passive auction observations through the generic transport unchanged", () => {
  const record = normalizeTelemetryRecord("event:auction-fixture", {
    revision: 1,
    updatedAt: auctionEnvelope.capturedAt,
    envelope: auctionEnvelope,
  });

  assert.equal(record.envelope.eventType, "auction_observation");
  assert.equal(record.envelope.payload.mode, "commodity_search");
  assert.equal(record.envelope.payload.query.itemId, 765);
  assert.equal(record.envelope.payload.rows.length, 2);
  assert.equal(record.envelope.payload.rows[0].unitPrice, 3100);
  assert.equal(record.envelope.payload.rows[1].quantity, 20);
  assert.equal(record.envelope.payload.rows[0].owner, undefined);
  assert.equal(record.envelope.payload.rows[0].bidder, undefined);

  const body = telemetryTransportBody(record);
  assert.equal(body.streamKey, "event:auction-fixture");
  assert.deepEqual(body.envelope.payload, auctionEnvelope.payload);
});

test("passes collector health state through the same generic transport", () => {
  const record = normalizeTelemetryRecord("collector_health_snapshot:fixture", {
    revision: 2,
    updatedAt: collectorHealthEnvelope.capturedAt,
    envelope: collectorHealthEnvelope,
  });

  assert.equal(record.envelope.eventType, "collector_health_snapshot");
  assert.equal(record.envelope.payload.addonVersion, "0.5.0-alpha.1");
  assert.equal(record.envelope.payload.capabilities.orderedEventQueue, true);
  assert.equal(record.envelope.payload.observed.stateStreamCount, 4);
  assert.equal(record.envelope.payload.eventQueue.capacity, 512);

  const body = telemetryTransportBody(record);
  assert.equal(body.streamKey, "collector_health_snapshot:fixture");
  assert.deepEqual(body.envelope.payload, collectorHealthEnvelope.payload);
});

test("produces a stable idempotency key for the same stream revision", () => {
  const record = normalizeTelemetryRecord("character_snapshot:fixture", {
    revision: 4,
    envelope,
  });
  const first = telemetryIdempotencyKey(record);
  const second = telemetryIdempotencyKey(record);

  assert.match(first, /^gw-[a-f0-9]{64}$/);
  assert.equal(first, second);
});

test("rejects malformed and unsupported telemetry without throwing on partial payload fields", () => {
  assert.throws(
    () =>
      normalizeTelemetryRecord("character_snapshot:fixture", {
        revision: 1,
        envelope: { ...envelope, schemaVersion: 99 },
      }),
    /unsupported envelope schema 99/,
  );

  assert.throws(
    () =>
      normalizeTelemetryRecord("character_snapshot:fixture", {
        revision: 0,
        envelope,
      }),
    /invalid revision/,
  );

  assert.throws(
    () =>
      normalizeTelemetryRecord("character_snapshot:fixture", {
        revision: 1,
        envelope: { ...envelope, payload: null },
      }),
    /payload must be an object/,
  );

  const partial = normalizeTelemetryRecord("future_event:fixture", {
    revision: 1,
    envelope: {
      schemaVersion: 1,
      eventType: "future_event",
      capturedAt: 123,
      payload: { safelyPartial: true },
    },
  });

  assert.equal(partial.envelope.realm, null);
  assert.equal(partial.envelope.installationId, null);
  assert.equal(partial.envelope.payload.safelyPartial, true);
});

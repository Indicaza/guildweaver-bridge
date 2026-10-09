import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  normalizeTelemetryRecord,
  telemetryIdempotencyKey,
  telemetryPayloadFingerprint,
  telemetryTransportBody,
} from "../src/telemetry.js";

const envelope = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/telemetry/character_snapshot.v1.json", import.meta.url),
    "utf8",
  ),
);

const modularDomains = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/telemetry/modular_domains.v1.json", import.meta.url),
    "utf8",
  ),
);

test("passes normalized character schema v3 through without domain-specific rewriting", () => {
  const record = normalizeTelemetryRecord("character_snapshot:fixture", {
    kind: "state",
    revision: 4,
    updatedAt: envelope.capturedAt,
    envelope,
  });

  assert.equal(record.kind, "state");
  assert.equal(record.revision, 4);
  assert.equal(record.envelope.schemaVersion, 1);
  assert.equal(record.envelope.eventType, "character_snapshot");
  assert.equal(record.envelope.payload.schemaVersion, 3);
  assert.equal(record.envelope.payload.name, "Rook");
  assert.equal(record.envelope.payload.class.token, "WARRIOR");
  assert.equal(record.envelope.payload.equipment[0].itemId, 5191);
  assert.equal(record.envelope.payload.equipment[0].iconFileDataId, 135324);
  assert.equal(record.envelope.payload.equipment[0].qualityId, 3);
  assert.equal(record.envelope.payload.talents.allocations[0].activeEntryId, 50001);
  assert.equal(record.envelope.payload.professions[0].recipes[0].recipeId, 1001);

  const body = telemetryTransportBody(record);
  assert.equal(body.streamKey, "character_snapshot:fixture");
  assert.equal(body.kind, "state");
  assert.equal(body.revision, 4);
  assert.deepEqual(body.envelope, envelope);
});

test("passes each modular telemetry domain through as opaque payload data", () => {
  for (const [eventType, domainEnvelope] of Object.entries(modularDomains)) {
    const record = normalizeTelemetryRecord(`${eventType}:character-rook`, {
      kind: "state",
      revision: 2,
      envelope: domainEnvelope,
    });

    assert.equal(record.envelope.eventType, eventType);
    assert.equal(record.envelope.payloadSchemaVersion, 1);
    assert.deepEqual(record.envelope.payload, domainEnvelope.payload);
    assert.deepEqual(telemetryTransportBody(record).envelope.payload, domainEnvelope.payload);
    assert.match(record.fingerprint, /^[a-f0-9]{64}$/);
  }
});

test("preserves future envelope metadata without interpreting it", () => {
  const domainEnvelope = {
    ...structuredClone(modularDomains.character),
    producer: { channel: "test", capabilities: ["future-field"] },
  };

  const record = normalizeTelemetryRecord("character:character-rook", {
    kind: "state",
    revision: 1,
    envelope: domainEnvelope,
  });

  assert.deepEqual(record.envelope.producer, domainEnvelope.producer);
  assert.deepEqual(record.envelope.addon, domainEnvelope.addon);
});

test("computes a stable generic fingerprint when the producer does not provide one", () => {
  const left = { schemaVersion: 1, nested: { b: 2, a: 1 } };
  const right = { nested: { a: 1, b: 2 }, schemaVersion: 1 };

  assert.equal(telemetryPayloadFingerprint(left), telemetryPayloadFingerprint(right));

  const record = normalizeTelemetryRecord("stats:character-rook", {
    revision: 1,
    envelope: {
      schemaVersion: 1,
      eventType: "stats",
      capturedAt: 123,
      characterId: "character-rook",
      payloadSchemaVersion: 1,
      payload: left,
    },
  });

  assert.equal(record.fingerprint, telemetryPayloadFingerprint(left));
});

test("passes generic definition streams through unchanged", () => {
  const definitionEnvelope = {
    schemaVersion: 1,
    eventType: "talent_tree_definition",
    capturedAt: 1791242820,
    gameBuild: envelope.gameBuild,
    installationId: envelope.installationId,
    payload: {
      schemaVersion: 1,
      class: { id: 1, name: "Warrior", token: "WARRIOR" },
      treeId: 20001,
      nodes: [
        {
          nodeId: 40001,
          entries: [
            {
              entryId: 50001,
              spellId: 70001,
              iconFileDataId: 132333,
            },
          ],
        },
      ],
      edges: [],
    },
  };

  const record = normalizeTelemetryRecord("talent_tree_definition:warrior:70235:20001", {
    kind: "state",
    revision: 1,
    envelope: definitionEnvelope,
  });

  assert.equal(record.envelope.eventType, "talent_tree_definition");
  assert.equal(record.envelope.payload.nodes[0].entries[0].spellId, 70001);
  assert.deepEqual(record.envelope.payload, definitionEnvelope.payload);
});

test("defaults legacy telemetry records to state", () => {
  const record = normalizeTelemetryRecord("character_snapshot:legacy", {
    revision: 1,
    envelope,
  });

  assert.equal(record.kind, "state");
});

test("produces a stable idempotency key for the same stream revision", () => {
  const record = normalizeTelemetryRecord("character_snapshot:fixture", {
    kind: "state",
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
        kind: "mystery",
        revision: 1,
        envelope,
      }),
    /unsupported kind mystery/,
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

  assert.throws(
    () =>
      normalizeTelemetryRecord("future_event:fixture", {
        revision: 1,
        envelope: {
          schemaVersion: 1,
          eventType: "future_event",
          capturedAt: 123,
          payloadSchemaVersion: 0,
          payload: { safelyPartial: true },
        },
      }),
    /invalid payloadSchemaVersion/,
  );

  const partial = normalizeTelemetryRecord("future_event:fixture", {
    kind: "event",
    revision: 1,
    envelope: {
      schemaVersion: 1,
      eventType: "future_event",
      capturedAt: 123,
      payload: { safelyPartial: true },
    },
  });

  assert.equal(partial.kind, "event");
  assert.equal(partial.envelope.realm, null);
  assert.equal(partial.envelope.installationId, null);
  assert.equal(partial.envelope.payload.safelyPartial, true);
});
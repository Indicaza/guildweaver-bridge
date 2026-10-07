import crypto from "node:crypto";

export const TELEMETRY_SCHEMA_VERSION = 1;
export const TELEMETRY_KINDS = new Set(["state", "event"]);

function optionalString(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function validTimestamp(value) {
  return (
    (typeof value === "number" && Number.isFinite(value) && value >= 0) ||
    (typeof value === "string" && value.trim().length > 0)
  );
}

export function normalizeTelemetryRecord(streamKey, record) {
  if (typeof streamKey !== "string" || !streamKey.trim()) {
    throw new Error("Telemetry stream key must be a non-empty string");
  }

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Telemetry ${streamKey} must be an object`);
  }

  const kind = optionalString(record.kind) || "state";
  if (!TELEMETRY_KINDS.has(kind)) {
    throw new Error(`Telemetry ${streamKey} has unsupported kind ${kind}`);
  }

  const revision = Number(record.revision);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error(`Telemetry ${streamKey} has an invalid revision`);
  }

  const envelope = record.envelope;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error(`Telemetry ${streamKey} is missing its envelope`);
  }

  if (Number(envelope.schemaVersion) !== TELEMETRY_SCHEMA_VERSION) {
    throw new Error(
      `Telemetry ${streamKey} uses unsupported envelope schema ${envelope.schemaVersion}`,
    );
  }

  const eventType = optionalString(envelope.eventType);
  if (!eventType) {
    throw new Error(`Telemetry ${streamKey} is missing eventType`);
  }

  if (!validTimestamp(envelope.capturedAt)) {
    throw new Error(`Telemetry ${streamKey} has an invalid capturedAt`);
  }

  if (
    !envelope.payload ||
    typeof envelope.payload !== "object" ||
    Array.isArray(envelope.payload)
  ) {
    throw new Error(`Telemetry ${streamKey} payload must be an object`);
  }

  const normalizedEnvelope = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventType,
    capturedAt: envelope.capturedAt,
    gameBuild:
      envelope.gameBuild && typeof envelope.gameBuild === "object"
        ? envelope.gameBuild
        : null,
    realm: optionalString(envelope.realm),
    region: optionalString(envelope.region),
    installationId: optionalString(envelope.installationId),
    characterId: optionalString(envelope.characterId),
    guildId: optionalString(envelope.guildId),
    sessionId: optionalString(envelope.sessionId),
    checkpoint: optionalString(envelope.checkpoint),
    payload: envelope.payload,
  };

  return {
    streamKey: streamKey.trim(),
    kind,
    revision,
    fingerprint: optionalString(record.fingerprint),
    updatedAt: record.updatedAt ?? envelope.capturedAt,
    envelope: normalizedEnvelope,
  };
}

export function telemetryIdempotencyKey(record) {
  const stableIdentity = JSON.stringify({
    streamKey: record.streamKey,
    kind: record.kind,
    revision: record.revision,
    installationId: record.envelope.installationId,
    characterId: record.envelope.characterId,
    eventType: record.envelope.eventType,
  });

  return `gw-${crypto.createHash("sha256").update(stableIdentity).digest("hex")}`;
}

export function telemetryTransportBody(record) {
  return {
    streamKey: record.streamKey,
    kind: record.kind,
    revision: record.revision,
    envelope: record.envelope,
  };
}
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

function appendStable(parts, value) {
  if (Array.isArray(value)) {
    parts.push("[");
    for (const entry of value) appendStable(parts, entry);
    parts.push("]");
    return;
  }

  if (value && typeof value === "object") {
    parts.push("{");
    for (const key of Object.keys(value).sort()) {
      parts.push(JSON.stringify(key), ":");
      appendStable(parts, value[key]);
      parts.push(",");
    }
    parts.push("}");
    return;
  }

  parts.push(JSON.stringify(value));
}

export function telemetryPayloadFingerprint(payload) {
  const parts = [];
  appendStable(parts, payload);
  return crypto.createHash("sha256").update(parts.join("")).digest("hex");
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

  if (
    envelope.payloadSchemaVersion !== undefined &&
    (!Number.isInteger(Number(envelope.payloadSchemaVersion)) || Number(envelope.payloadSchemaVersion) < 1)
  ) {
    throw new Error(`Telemetry ${streamKey} has an invalid payloadSchemaVersion`);
  }

  const sessionId = optionalString(envelope.sessionId);
  const checkpoint = optionalString(envelope.checkpoint);
  const normalizedEnvelope = {
    ...envelope,
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
    ...(sessionId ? { sessionId } : {}),
    ...(checkpoint ? { checkpoint } : {}),
    payload: envelope.payload,
  };

  return {
    streamKey: streamKey.trim(),
    kind,
    revision,
    fingerprint:
      optionalString(record.fingerprint) || telemetryPayloadFingerprint(envelope.payload),
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
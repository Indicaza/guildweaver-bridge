import { findForbiddenTelemetryField } from "./privacy.js";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function cleanString(value, maxLength) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function optionalString(value, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  return cleanString(value, maxLength);
}

function timestamp(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return new Date(value * 1000).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return null;
}

export function validateEnrollmentBody(value) {
  const body = object(value);
  if (!body) return { error: "invalid_enrollment" };

  const enrollmentCode = cleanString(body.enrollmentCode, 512);
  if (!enrollmentCode) return { error: "enrollment_code_required" };

  const installationId = optionalString(body.installationId, 160);
  const metadata = body.metadata === undefined ? {} : object(body.metadata);
  if (!metadata) return { error: "invalid_installation_metadata" };

  const metadataSize = Buffer.byteLength(JSON.stringify(metadata), "utf8");
  if (metadataSize > 16 * 1024) return { error: "installation_metadata_too_large" };

  return {
    value: {
      enrollmentCode,
      installationId,
      metadata,
    },
  };
}

export function validateTelemetryBody(value) {
  const body = object(value);
  if (!body) return { error: "invalid_telemetry_record" };

  const streamKey = cleanString(body.streamKey, 256);
  const revision = Number(body.revision);
  const envelope = object(body.envelope);

  if (!streamKey) return { error: "invalid_stream_key" };
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return { error: "invalid_revision" };
  }
  if (!envelope) return { error: "invalid_envelope" };
  if (Number(envelope.schemaVersion) !== 1) {
    return { error: "unsupported_envelope_schema" };
  }

  const eventType = cleanString(envelope.eventType, 80);
  if (!eventType || !/^[a-z0-9_]+$/.test(eventType)) {
    return { error: "invalid_event_type" };
  }

  const capturedAt = timestamp(envelope.capturedAt);
  if (!capturedAt) return { error: "invalid_captured_at" };

  const payload = object(envelope.payload);
  if (!payload) return { error: "invalid_payload" };

  const forbiddenPath = findForbiddenTelemetryField(envelope);
  if (forbiddenPath) {
    return { error: "privacy_forbidden_field", forbiddenPath };
  }

  return {
    value: {
      streamKey,
      revision,
      envelope: {
        schemaVersion: 1,
        eventType,
        capturedAt: envelope.capturedAt,
        gameBuild: object(envelope.gameBuild),
        realm: optionalString(envelope.realm, 160),
        region: optionalString(envelope.region, 32),
        installationId: optionalString(envelope.installationId, 160),
        characterId: optionalString(envelope.characterId, 160),
        guildId: optionalString(envelope.guildId, 160),
        payload,
      },
      capturedAt,
    },
  };
}

export function validateCheckpointBody(value) {
  const body = object(value);
  const cursor = Number(body?.cursor);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    return { error: "invalid_cursor" };
  }
  return { value: { cursor } };
}

import { normalizeTelemetryRecord } from "./telemetry.js";

export function outboundTelemetryEvents(database) {
  const queue = database?.sync?.outbound?.events;

  if (!queue || typeof queue !== "object" || Array.isArray(queue)) {
    return { nextSequence: 0, dropped: 0, items: [] };
  }

  const rawItems = queue.items;
  if (!rawItems || typeof rawItems !== "object" || Array.isArray(rawItems)) {
    return {
      nextSequence: Number(queue.nextSequence) || 0,
      dropped: Number(queue.dropped) || 0,
      items: [],
    };
  }

  const items = [];

  for (const [eventId, raw] of Object.entries(rawItems)) {
    try {
      items.push(normalizeTelemetryEvent(eventId, raw));
    } catch (error) {
      items.push({ eventId, error });
    }
  }

  items.sort((left, right) => {
    const leftSequence = Number(left.sequence) || Number.MAX_SAFE_INTEGER;
    const rightSequence = Number(right.sequence) || Number.MAX_SAFE_INTEGER;
    return leftSequence - rightSequence;
  });

  return {
    nextSequence: Number(queue.nextSequence) || 0,
    dropped: Number(queue.dropped) || 0,
    items,
  };
}

export function normalizeTelemetryEvent(eventId, raw) {
  if (typeof eventId !== "string" || !eventId.trim()) {
    throw new Error("Telemetry event id must be a non-empty string");
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Telemetry event ${eventId} must be an object`);
  }

  if (Number(raw.schemaVersion) !== 1) {
    throw new Error(`Telemetry event ${eventId} uses unsupported record schema ${raw.schemaVersion}`);
  }

  if (raw.eventId && String(raw.eventId) !== eventId) {
    throw new Error(`Telemetry event ${eventId} has a mismatched eventId`);
  }

  const sequence = Number(raw.sequence);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Telemetry event ${eventId} has an invalid sequence`);
  }

  const record = normalizeTelemetryRecord(`event:${eventId}`, {
    revision: 1,
    updatedAt: raw.createdAt ?? raw.envelope?.capturedAt,
    envelope: raw.envelope,
  });

  return {
    eventId,
    sequence,
    createdAt: raw.createdAt ?? raw.envelope?.capturedAt,
    record,
  };
}

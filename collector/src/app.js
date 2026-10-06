import http from "node:http";

import { identifier, opaqueToken, tokenHash } from "./crypto.js";
import { logger as defaultLogger } from "./logger.js";
import { FixedWindowRateLimiter } from "./rateLimit.js";
import {
  validateCheckpointBody,
  validateEnrollmentBody,
  validateTelemetryBody,
} from "./validation.js";

function sendJson(res, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function clientAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function bearerToken(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function idempotencyKey(req) {
  const value = String(req.headers["idempotency-key"] || "").trim();
  return value && value.length <= 256 ? value : null;
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }

  if (tooLarge) {
    const error = new Error("request_too_large");
    error.status = 413;
    throw error;
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("invalid_json");
    error.status = 400;
    throw error;
  }
}

function integerQuery(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function consumerEvent(event) {
  return {
    id: event.id,
    streamKey: event.streamKey,
    revision: event.revision,
    eventType: event.eventType,
    capturedAt: event.capturedAt,
    receivedAt: event.receivedAt,
    envelope: event.envelope,
  };
}

export function createCollectorServer({
  store,
  config = {},
  logger = defaultLogger,
} = {}) {
  if (!store) throw new Error("collector store is required");

  const requestBodyLimitBytes =
    Number(config.requestBodyLimitBytes) || 2 * 1024 * 1024;
  const windowMs = Number(config.rateLimitWindowMs) || 10 * 60 * 1000;
  const enrollmentLimiter = new FixedWindowRateLimiter({
    max: Number(config.enrollmentRateLimit) || 30,
    windowMs,
  });
  const ingestLimiter = new FixedWindowRateLimiter({
    max: Number(config.ingestRateLimit) || 300,
    windowMs,
  });
  const consumerLimiter = new FixedWindowRateLimiter({
    max: Number(config.consumerRateLimit) || 600,
    windowMs,
  });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://collector.local");
    const route = `${req.method || "GET"} ${url.pathname}`;

    try {
      if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/readyz") {
        try {
          await store.ping();
          sendJson(res, 200, { status: "ready" });
        } catch {
          sendJson(res, 503, { error: "database_unavailable" });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/installations/enroll") {
        const address = clientAddress(req);
        if (!enrollmentLimiter.allow(address)) {
          sendJson(res, 429, { error: "rate_limited" });
          return;
        }

        const parsed = validateEnrollmentBody(
          await readJsonBody(req, requestBodyLimitBytes),
        );
        if (parsed.error) {
          sendJson(res, 400, { error: parsed.error });
          return;
        }

        const telemetryToken = opaqueToken("gwt");
        const publicId = parsed.value.installationId || identifier("install");
        const result = await store.consumeEnrollmentCode({
          codeHash: tokenHash(parsed.value.enrollmentCode),
          installationId: identifier("installation"),
          publicId,
          tokenHash: tokenHash(telemetryToken),
          metadata: parsed.value.metadata,
        });

        if (result.status === "invalid-code") {
          sendJson(res, 403, { error: "invalid_enrollment_code" });
          return;
        }
        if (result.status === "installation-exists") {
          sendJson(res, 409, { error: "installation_already_enrolled" });
          return;
        }

        const issuedAt = new Date().toISOString();
        logger.info("collector installation enrolled", {
          installationId: publicId,
        });
        sendJson(res, 201, {
          schemaVersion: 1,
          installationId: publicId,
          telemetryToken,
          issuedAt,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/v1/telemetry") {
        const token = bearerToken(req);
        const installation = token
          ? await store.authenticateInstallation(tokenHash(token))
          : null;
        if (!installation) {
          sendJson(res, 401, { error: "invalid_telemetry_token" });
          return;
        }
        if (!ingestLimiter.allow(installation.id)) {
          sendJson(res, 429, { error: "rate_limited" });
          return;
        }

        const key = idempotencyKey(req);
        if (!key) {
          sendJson(res, 400, { error: "idempotency_key_required" });
          return;
        }

        const parsed = validateTelemetryBody(
          await readJsonBody(req, requestBodyLimitBytes),
        );
        if (parsed.error) {
          sendJson(res, 400, {
            error: parsed.error,
            ...(parsed.forbiddenPath
              ? { forbiddenPath: parsed.forbiddenPath }
              : {}),
          });
          return;
        }

        if (!parsed.value.envelope.installationId) {
          sendJson(res, 400, { error: "installation_id_required" });
          return;
        }
        if (parsed.value.envelope.installationId !== installation.publicId) {
          sendJson(res, 403, { error: "installation_id_mismatch" });
          return;
        }

        const result = await store.ingestTelemetry({
          installationId: installation.id,
          idempotencyKey: key,
          record: parsed.value,
          capturedAt: parsed.value.capturedAt,
        });

        logger.info("collector telemetry ingested", {
          status: result.status,
          eventId: result.event.id,
          eventType: parsed.value.envelope.eventType,
          streamKey: parsed.value.streamKey,
          revision: parsed.value.revision,
          installationId: installation.publicId,
        });
        sendJson(res, result.status === "accepted" ? 202 : 200, {
          status: result.status,
          eventId: result.event.id,
        });
        return;
      }

      if (url.pathname === "/v1/events" && req.method === "GET") {
        const token = bearerToken(req);
        const consumer = token
          ? await store.authenticateConsumer(tokenHash(token))
          : null;
        if (!consumer) {
          sendJson(res, 401, { error: "invalid_consumer_token" });
          return;
        }
        if (!consumerLimiter.allow(consumer.id)) {
          sendJson(res, 429, { error: "rate_limited" });
          return;
        }

        const checkpoint = await store.getConsumerCheckpoint(consumer.id);
        const after = url.searchParams.has("after")
          ? integerQuery(url.searchParams.get("after"), checkpoint, { min: 0 })
          : checkpoint;
        const limit = integerQuery(url.searchParams.get("limit"), 100, {
          min: 1,
          max: 500,
        });
        const eventType = String(url.searchParams.get("eventType") || "").trim();
        const events = await store.listEvents({
          after,
          limit,
          eventType: eventType || null,
        });
        const nextCursor = events.length ? events[events.length - 1].id : after;

        sendJson(res, 200, {
          events: events.map(consumerEvent),
          checkpoint,
          nextCursor,
        });
        return;
      }

      if (
        url.pathname === "/v1/consumers/checkpoint" &&
        req.method === "POST"
      ) {
        const token = bearerToken(req);
        const consumer = token
          ? await store.authenticateConsumer(tokenHash(token))
          : null;
        if (!consumer) {
          sendJson(res, 401, { error: "invalid_consumer_token" });
          return;
        }
        if (!consumerLimiter.allow(consumer.id)) {
          sendJson(res, 429, { error: "rate_limited" });
          return;
        }

        const parsed = validateCheckpointBody(
          await readJsonBody(req, requestBodyLimitBytes),
        );
        if (parsed.error) {
          sendJson(res, 400, { error: parsed.error });
          return;
        }

        const cursor = await store.setConsumerCheckpoint(
          consumer.id,
          parsed.value.cursor,
        );
        sendJson(res, 200, { checkpoint: cursor });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (error?.status === 413) {
        sendJson(res, 413, { error: "request_too_large" });
        return;
      }
      if (error?.status === 400 || error?.message === "invalid_json") {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }

      logger.error("collector request failed", {
        route,
        error: String(error?.message || error),
      });
      sendJson(res, 500, { error: "internal_error" });
    }
  });
}

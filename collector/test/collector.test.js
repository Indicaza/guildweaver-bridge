import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createCollectorServer } from "../src/app.js";
import { identifier, tokenHash } from "../src/crypto.js";
import { MemoryCollectorStore } from "../src/store/memory.js";

const canonicalEnvelope = JSON.parse(
  fs.readFileSync(
    new URL("../../fixtures/telemetry/character_snapshot.v1.json", import.meta.url),
    "utf8",
  ),
);

async function withCollector(callback, overrides = {}) {
  const store = new MemoryCollectorStore();
  const enrollmentCode = overrides.enrollmentCode || "gwe_test_enrollment";
  await store.createEnrollmentCode({
    id: identifier("enrollment"),
    codeHash: tokenHash(enrollmentCode),
    label: "test",
    maxUses: overrides.maxEnrollmentUses || 10,
  });
  const server = createCollectorServer({
    store,
    config: {
      requestBodyLimitBytes: overrides.requestBodyLimitBytes || 2 * 1024 * 1024,
      enrollmentRateLimit: 100,
      ingestRateLimit: 1000,
      consumerRateLimit: 1000,
      rateLimitWindowMs: 60_000,
    },
    logger: { info() {}, warn() {}, error() {} },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function request(path, { method = "GET", token = null, body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
    };
  }

  async function enroll(installationId = canonicalEnvelope.installationId) {
    const response = await request("/v1/installations/enroll", {
      method: "POST",
      body: {
        enrollmentCode,
        installationId,
        metadata: { bridgeVersion: "0.10.0-alpha.1", platform: "test" },
      },
    });
    assert.equal(response.status, 201);
    return response.body;
  }

  try {
    await callback({ store, request, enroll, enrollmentCode });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function telemetryBody(envelope = canonicalEnvelope, revision = 3) {
  return {
    streamKey: `character_snapshot:${envelope.characterId}`,
    revision,
    envelope,
  };
}

test("health and readiness do not expose collector secrets", async () => {
  await withCollector(async ({ request }) => {
    assert.deepEqual(await request("/healthz"), {
      status: 200,
      body: { status: "ok" },
    });
    assert.deepEqual(await request("/readyz"), {
      status: 200,
      body: { status: "ready" },
    });
  });
});

test("enrollment issues one scoped token while storing only its hash", async () => {
  await withCollector(async ({ store, enroll }) => {
    const enrolled = await enroll();
    assert.match(enrolled.telemetryToken, /^gwt_/);
    assert.equal(enrolled.installationId, canonicalEnvelope.installationId);

    const installation = await store.authenticateInstallation(
      tokenHash(enrolled.telemetryToken),
    );
    assert.ok(installation);
    assert.equal(installation.publicId, canonicalEnvelope.installationId);
    assert.notEqual(installation.tokenHash, enrolled.telemetryToken);
  });
});

test("invalid enrollment codes are rejected", async () => {
  await withCollector(async ({ request }) => {
    const response = await request("/v1/installations/enroll", {
      method: "POST",
      body: {
        enrollmentCode: "gwe_not_valid",
        installationId: "install-invalid",
      },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error, "invalid_enrollment_code");
  });
});

test("canonical telemetry is accepted once and retries are idempotent", async () => {
  await withCollector(async ({ store, request, enroll }) => {
    const enrolled = await enroll();
    const body = telemetryBody();
    const headers = { "Idempotency-Key": "gw-canonical-3" };

    const first = await request("/v1/telemetry", {
      method: "POST",
      token: enrolled.telemetryToken,
      body,
      headers,
    });
    assert.equal(first.status, 202);
    assert.equal(first.body.status, "accepted");

    const retry = await request("/v1/telemetry", {
      method: "POST",
      token: enrolled.telemetryToken,
      body,
      headers,
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.status, "duplicate");
    assert.equal(retry.body.eventId, first.body.eventId);

    const sameRevisionDifferentKey = await request("/v1/telemetry", {
      method: "POST",
      token: enrolled.telemetryToken,
      body,
      headers: { "Idempotency-Key": "gw-canonical-new-key" },
    });
    assert.equal(sameRevisionDifferentKey.status, 200);
    assert.equal(sameRevisionDifferentKey.body.status, "duplicate");
    assert.equal(store.events.length, 1);
  });
});

test("two installations may submit the same stream revision independently", async () => {
  await withCollector(async ({ store, request, enroll }) => {
    const firstEnrollment = await enroll(canonicalEnvelope.installationId);
    const secondEnvelope = structuredClone(canonicalEnvelope);
    secondEnvelope.installationId = "install-second";
    const secondEnrollment = await enroll(secondEnvelope.installationId);

    const first = await request("/v1/telemetry", {
      method: "POST",
      token: firstEnrollment.telemetryToken,
      headers: { "Idempotency-Key": "same-key" },
      body: telemetryBody(canonicalEnvelope),
    });
    const second = await request("/v1/telemetry", {
      method: "POST",
      token: secondEnrollment.telemetryToken,
      headers: { "Idempotency-Key": "same-key" },
      body: telemetryBody(secondEnvelope),
    });

    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.equal(store.events.length, 2);
  });
});

test("installation tokens cannot submit another installation id", async () => {
  await withCollector(async ({ request, enroll }) => {
    const enrolled = await enroll();
    const envelope = structuredClone(canonicalEnvelope);
    envelope.installationId = "install-spoofed";

    const response = await request("/v1/telemetry", {
      method: "POST",
      token: enrolled.telemetryToken,
      headers: { "Idempotency-Key": "spoof-attempt" },
      body: telemetryBody(envelope),
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error, "installation_id_mismatch");
  });
});

test("revoked installation tokens are rejected", async () => {
  await withCollector(async ({ store, request, enroll }) => {
    const enrolled = await enroll();
    await store.revokeInstallation(enrolled.installationId);

    const response = await request("/v1/telemetry", {
      method: "POST",
      token: enrolled.telemetryToken,
      headers: { "Idempotency-Key": "revoked" },
      body: telemetryBody(),
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.error, "invalid_telemetry_token");
  });
});

test("unsupported envelope schemas and privacy-forbidden fields are rejected", async () => {
  await withCollector(async ({ request, enroll }) => {
    const enrolled = await enroll();
    const future = structuredClone(canonicalEnvelope);
    future.schemaVersion = 99;

    const futureResponse = await request("/v1/telemetry", {
      method: "POST",
      token: enrolled.telemetryToken,
      headers: { "Idempotency-Key": "future" },
      body: telemetryBody(future),
    });
    assert.equal(futureResponse.status, 400);
    assert.equal(futureResponse.body.error, "unsupported_envelope_schema");

    const privatePayload = structuredClone(canonicalEnvelope);
    privatePayload.payload.battleTag = "DoNotCollect#1234";
    const privateResponse = await request("/v1/telemetry", {
      method: "POST",
      token: enrolled.telemetryToken,
      headers: { "Idempotency-Key": "privacy" },
      body: telemetryBody(privatePayload),
    });
    assert.equal(privateResponse.status, 400);
    assert.equal(privateResponse.body.error, "privacy_forbidden_field");
    assert.equal(privateResponse.body.forbiddenPath, "payload.battleTag");
  });
});

test("oversize request bodies are rejected before ingestion", async () => {
  await withCollector(
    async ({ store, request, enroll }) => {
      const enrolled = await enroll();
      const envelope = structuredClone(canonicalEnvelope);
      envelope.payload.padding = "x".repeat(4000);

      const response = await request("/v1/telemetry", {
        method: "POST",
        token: enrolled.telemetryToken,
        headers: { "Idempotency-Key": "too-large" },
        body: telemetryBody(envelope),
      });
      assert.equal(response.status, 413);
      assert.equal(response.body.error, "request_too_large");
      assert.equal(store.events.length, 0);
    },
    { requestBodyLimitBytes: 3000 },
  );
});

test("consumer cursor feeds and persisted checkpoints resume safely", async () => {
  await withCollector(async ({ store, request, enroll }) => {
    const enrolled = await enroll();
    const secondEnvelope = structuredClone(canonicalEnvelope);
    secondEnvelope.payload.level = 31;

    await request("/v1/telemetry", {
      method: "POST",
      token: enrolled.telemetryToken,
      headers: { "Idempotency-Key": "event-1" },
      body: telemetryBody(canonicalEnvelope, 3),
    });
    await request("/v1/telemetry", {
      method: "POST",
      token: enrolled.telemetryToken,
      headers: { "Idempotency-Key": "event-2" },
      body: telemetryBody(secondEnvelope, 4),
    });

    const consumerToken = "gwc_test_consumer";
    await store.createConsumer({
      id: "consumer-test",
      name: "Holdfast test consumer",
      tokenHash: tokenHash(consumerToken),
    });

    const firstPage = await request("/v1/events?limit=1", {
      token: consumerToken,
    });
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.body.checkpoint, 0);
    assert.equal(firstPage.body.events.length, 1);
    assert.equal(firstPage.body.nextCursor, 1);

    const checkpoint = await request("/v1/consumers/checkpoint", {
      method: "POST",
      token: consumerToken,
      body: { cursor: firstPage.body.nextCursor },
    });
    assert.equal(checkpoint.status, 200);
    assert.equal(checkpoint.body.checkpoint, 1);

    const resumed = await request("/v1/events", { token: consumerToken });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.checkpoint, 1);
    assert.equal(resumed.body.events.length, 1);
    assert.equal(resumed.body.events[0].id, 2);

    const regression = await request("/v1/consumers/checkpoint", {
      method: "POST",
      token: consumerToken,
      body: { cursor: 0 },
    });
    assert.equal(regression.body.checkpoint, 1);
  });
});

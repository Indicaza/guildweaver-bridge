import { syncOnce } from "../src/sync.js";

export function fixtureSyncOnce(config, options = {}) {
  const fetchImpl = options.fetchImpl;
  if (!fetchImpl) throw new Error("Fixture must provide a mock fetch");
  return syncOnce(config, { ...options, fetchImpl: async (url, init) => {
    const response = await fetchImpl(url, init);
    if (url !== config.telemetryEndpoint || !response.ok || init?.method !== "POST") return response;
    const body = await response.clone().json().catch(() => null);
    if (!body || !["accepted", "updated", "created", "duplicate", "unchanged"].includes(body.status)) return response;
    const request = JSON.parse(init.body);
    return new Response(JSON.stringify({
      ...body, status: body.status === "duplicate" ? "duplicate" : "created",
      recordId: 1, streamKey: request.streamKey, revision: request.revision,
      receiptKey: init.headers["Idempotency-Key"],
    }), { status: response.status, headers: response.headers });
  } });
}

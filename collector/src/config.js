function integer(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function boolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function loadCollectorConfig(env = process.env) {
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  return {
    host: String(env.HOST || "0.0.0.0"),
    port: integer(env.PORT, 8787),
    databaseUrl,
    databaseSsl: boolean(env.DATABASE_SSL, false),
    requestBodyLimitBytes: integer(env.REQUEST_BODY_LIMIT_BYTES, 2 * 1024 * 1024),
    enrollmentRateLimit: integer(env.ENROLLMENT_RATE_LIMIT, 30),
    ingestRateLimit: integer(env.INGEST_RATE_LIMIT, 300),
    consumerRateLimit: integer(env.CONSUMER_RATE_LIMIT, 600),
    rateLimitWindowMs: integer(env.RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
  };
}

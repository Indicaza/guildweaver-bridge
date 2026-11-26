import { setTimeout as sleep } from "node:timers/promises";

const MAX_RESPONSE_BYTES = 512 * 1024;
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

async function bodyJson(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("Archive response exceeded its size limit");
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (response.ok) throw error;
    return null;
  } finally { reader.releaseLock(); }
}

export function retryDelay(response, fallbackSeconds = 3, random = Math.random) {
  const raw = response?.headers?.get("Retry-After");
  const seconds = raw && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw ? Math.max(0, (Date.parse(raw) - Date.now()) / 1000) : NaN;
  const base = Number.isFinite(seconds) ? Math.max(1, seconds) : fallbackSeconds;
  return Math.ceil(base * 1000 + random() * 1500);
}

export async function archiveHttp(config, credentials, route, { fetchImpl = fetch, method = "GET", body, signal, timeout = 15000, bulk = false } = {}) {
  const headers = { Authorization: "Bearer " + credentials.deviceToken, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetchImpl(config.holdfastUrl + "/api/bridge/archive/" + route, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
  });
  return { response, data: await bodyJson(response, bulk ? 1280 * 1024 : MAX_RESPONSE_BYTES) };
}

export async function queuedArchivePage(config, credentials, query, {
  fetchImpl = fetch, sleepImpl = sleep, now = Date.now, random = Math.random, progress = () => {}, signal,
} = {}) {
  const deadline = now() + 10 * 60_000;
  let ticket = null, failures = 0, attempts = 0;
  const wait = async (ms) => {
    if (now() + ms > deadline) throw new Error("Archive wait budget exhausted; rerun to resume verified pages.");
    await sleepImpl(ms, undefined, { signal });
  };
  try {
    while (now() < deadline && attempts++ < 200) {
      signal?.throwIfAborted();
      let answer;
      try {
        answer = await archiveHttp(config, credentials, ticket ? "jobs/" + encodeURIComponent(ticket) : "jobs", {
          fetchImpl, signal, bulk: query.bulk === true, method: ticket ? "GET" : "POST",
          ...(ticket ? {} : { body: query }),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        if (++failures > 8) throw new Error("Archive connection repeatedly failed; rerun to resume.");
        const ms = retryDelay(null, Math.min(30, 2 ** failures), random);
        progress({ stage: "retry", delayMs: ms });
        await wait(ms);
        continue;
      }
      const { response, data } = answer;
      if (response.status === 404 && ticket) {
        ticket = null;
        progress({ stage: "expired" });
        await wait(retryDelay(response, 2, random));
        continue;
      }
      if (response.status === 404 && !ticket) throw new Error("The website does not support queued archives yet; deploy the archive queue first.");
      if (TRANSIENT.has(response.status)) {
        const busy = response.status === 429 || ["bridge_busy", "archive_queue_full", "archive_queue_busy", "archive_busy"].includes(data?.error);
        if (!busy && ++failures > 8) throw new Error("Archive worker repeatedly failed; rerun to resume.");
        if (!busy && response.status === 503 && ticket && data?.error === "archive_unavailable") ticket = null;
        const ms = retryDelay(response, busy ? 5 : Math.min(30, 2 ** failures), random);
        progress({ stage: "retry", delayMs: ms, busy, httpStatus: response.status });
        await wait(ms);
        continue;
      }
      if (response.status === 409 && data?.error === "archive_hold_changed") throw new Error("Archive hold changed. Preserve this directory; start a new transfer under a new hold.");
      if (!response.ok) throw new Error("Archive request failed (HTTP " + response.status + "). Check device authorization and dataset.");
      if (!data || typeof data.ticket !== "string" || !/^[a-f0-9-]{36}$/i.test(data.ticket)
          || (ticket && data.ticket !== ticket)) throw new Error("Invalid archive ticket response");
      ticket = data.ticket;
      failures = 0;
      if (data.status === "ready" && response.status === 200 && data.result) {
        progress({ stage: "received" });
        const readyTicket = ticket;
        return { result: data.result, release: async () => {
          try { await archiveHttp(config, credentials, "jobs/" + encodeURIComponent(readyTicket), { fetchImpl, method: "DELETE", timeout: 3000 }); } catch {}
        } };
      }
      if (response.status !== 202 || !["queued", "running"].includes(data.status)
          || !Number.isInteger(data.position) || data.position < 0 || data.position > 32
          || (data.status === "queued" && data.position < 1)) throw new Error("Invalid archive queue state");
      progress({ stage: data.status, position: data.position });
      await wait(retryDelay(response, 2, random));
    }
    throw new Error("Archive wait budget exhausted; rerun to resume verified pages.");
  } catch (error) {
    if (ticket) {
      try { await archiveHttp(config, credentials, "jobs/" + encodeURIComponent(ticket), { fetchImpl, method: "DELETE", timeout: 3000 }); } catch {}
    }
    throw error;
  }
}

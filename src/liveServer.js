export function createLiveServerCheck(config, { fetchImpl = fetch, now = Date.now } = {}) {
  let ready = false;
  let nextAttempt = 0;
  return async () => {
    if (ready) return;
    if (now() < nextAttempt) throw new Error("Waiting for the WoW Forever website deployment");
    nextAttempt = now() + 15000;
    const response = await fetchImpl(`${config.holdfastUrl}/api/bridge/release`, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(10000),
    });
    const body = response.ok ? await response.json() : null;
    if (body?.gameRelease !== "forever-live") {
      throw new Error("Waiting for the WoW Forever website deployment");
    }
    ready = true;
  };
}

export function createBackpressure({ fetchImpl = fetch, now = Date.now, random = Math.random } = {}) {
  let until = 0;
  const remainingMs = () => Math.max(0, until - now());
  function check() {
    const remaining = remainingMs();
    if (remaining > 0) {
      const error = new Error("Website busy; synchronization retained locally. Retry in " + Math.ceil(remaining / 1000) + "s.");
      error.name = "BridgeBackpressureError";
      throw error;
    }
  }
  return {
    remainingMs, check,
    async fetch(url, options) {
      check();
      const response = await fetchImpl(url, options);
      if (response.status === 429 || (response.status === 503 && response.headers.get("X-Guildweaver-Backpressure") === "1")) {
        const header = response.headers.get("Retry-After");
        const numeric = header !== null && /^\d+$/.test(header) ? Number(header) * 1000 : NaN;
        const dateDelay = header ? Date.parse(header) - now() : NaN;
        const requested = Number.isFinite(numeric) ? numeric : Number.isFinite(dateDelay) ? dateDelay : 3000;
        until = Math.max(until, now() + Math.max(1000, requested) + Math.floor(random() * 2000));
        try { await response.body?.cancel(); } catch {}
        check();
      }
      return response;
    },
  };
}

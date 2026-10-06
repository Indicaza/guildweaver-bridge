export class FixedWindowRateLimiter {
  constructor({ max, windowMs, now = Date.now }) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.entries = new Map();
  }

  allow(key) {
    const current = this.now();
    const id = String(key || "anonymous");
    const existing = this.entries.get(id);

    if (!existing || current >= existing.resetAt) {
      this.entries.set(id, { count: 1, resetAt: current + this.windowMs });
      return true;
    }

    if (existing.count >= this.max) return false;
    existing.count += 1;
    return true;
  }
}

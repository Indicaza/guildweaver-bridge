const FORBIDDEN_KEY_PATTERNS = [
  /battletag/,
  /accountid/,
  /accountidentifier/,
  /whispers?/,
  /chatlogs?/,
  /privatemessages?/,
];

function normalizedKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function findForbiddenTelemetryField(value, path = "", depth = 0) {
  if (depth > 32 || value === null || value === undefined) return null;
  if (typeof value !== "object") return null;

  for (const [key, child] of Object.entries(value)) {
    const currentPath = path ? `${path}.${key}` : key;
    const normalized = normalizedKey(key);

    if (FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return currentPath;
    }

    const nested = findForbiddenTelemetryField(child, currentPath, depth + 1);
    if (nested) return nested;
  }

  return null;
}

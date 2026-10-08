import fs from "node:fs";
import path from "node:path";

function emptyObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function invalidateOutboundDeliveryCache(statePath) {
  if (!statePath || !fs.existsSync(statePath)) return false;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return false;
  }

  const state = emptyObject(parsed);
  state.sentRevisions = {};
  state.sentTelemetryRevisions = {};
  state.sentTelemetryFingerprints = {};

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, statePath);
  return true;
}

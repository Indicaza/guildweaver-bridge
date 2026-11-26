import fs from "node:fs";
import path from "node:path";
import { findAddonPath, findSavedVariablesFiles } from "./discovery.js";
import { lockedInstanceStatus } from "./instanceLock.js";
import { readCredentials } from "./pairing.js";
import { packagedRuntime } from "./packageUpdater.js";
import { parseSavedVariables, assertSupportedSavedVariablesSchema, outboundTelemetry } from "./savedVariables.js";
import { requestAgent } from "./agent.js";
import { releaseIssue } from "./releaseValidation.js";

const MAX_SCAN_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 16;
const KNOWN_REASONS = new Set(["live", "live_realm_unavailable", "realm_unavailable", "test_build", "test_realm", "unsupported_interface", "interface_unavailable"]);
function releaseLabel(value) {
  return typeof value === "string" && /^[a-zA-Z0-9.+_-]{1,100}$/.test(value) ? value : null;
}
function jsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
export async function diagnose(config, { fetchImpl = fetch, request = requestAgent, runtime = packagedRuntime } = {}) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const bridge = lockedInstanceStatus(config.lockPath);
  const credentials = readCredentials(config.credentialsPath);
  add("Background bridge", bridge.running ? "pass" : "warn", bridge.running ? "Running" : "Not running");
  add("Pairing", credentials ? "pass" : "warn", credentials ? "Local credentials present (not a server authentication check)" : "Not paired; run gw pair");
  if (bridge.running) {
    try {
      const agent = await request(config, "ping", []);
      add("Local command agent", agent?.ready === true ? "pass" : "warn", agent?.ready === true ? "Responding" : "Unexpected reply");
    } catch { add("Local command agent", "warn", "Not responding; restart the updated bridge"); }
  }
  const installed = runtime()?.release;
  add("Bridge build", "info", releaseLabel(installed?.releaseVersion) || "Source checkout or no package manifest");
  try {
    const addon = findAddonPath(config);
    const exists = fs.existsSync(path.join(addon, "Guildweaver.toc"));
    const manifest = jsonFile(path.join(addon, "release.json"));
    add("Addon files", exists ? "pass" : "fail", exists ? releaseLabel(manifest?.releaseVersion) || "Installed; build manifest unavailable" : "Guildweaver.toc not found");
  } catch { add("Addon files", "fail", "WoW Forever installation not found"); }
  try {
    const files = findSavedVariablesFiles(config);
    const reasons = {};
    let readable = 0, live = 0, queued = 0, skipped = 0;
    for (const file of files.slice(0, MAX_FILES)) {
      try {
        if (fs.statSync(file).size > MAX_SCAN_BYTES) { skipped++; continue; }
        const database = parseSavedVariables(fs.readFileSync(file, "utf8"));
        assertSupportedSavedVariablesSchema(database);
        readable++;
        const issue = releaseIssue(database, file);
        if (!issue) live++;
        const reason = !issue ? "accepted" : database.gameRelease !== "forever-live" && !database.meta?.releaseValidation?.reason ? "missing_live_marker" : database.meta?.releaseValidation?.reason === "live_realm_unavailable" && database.gameRelease === "forever-live" ? "unsupported_realm_free_save" : KNOWN_REASONS.has(database.meta?.releaseValidation?.reason) ? database.meta.releaseValidation.reason : "unknown";
        reasons[reason] = (reasons[reason] || 0) + 1;
        queued += Object.keys(outboundTelemetry(database)).length;
      } catch { skipped++; }
    }
    skipped += Math.max(0, files.length - MAX_FILES);
    add("SavedVariables", readable && !skipped ? "pass" : readable ? "warn" : "fail", readable + " readable; " + skipped + " unavailable or over scan limit");
    add("Forever validation", live && live === readable ? "pass" : "warn", live + " accepted save(s); " + Object.entries(reasons).map(([key, value]) => key + ": " + value).join(", ") + (live < readable ? "; next WoW login and /reload will refresh validation" : ""));
    add("Local telemetry queue", "info", queued + " records present (may already be delivered); /reload saves changes");
  } catch { add("SavedVariables", "warn", "No saved data found; log in and /reload"); }
  try {
    const response = await fetchImpl(config.holdfastUrl + "/api/bridge/release", { signal: AbortSignal.timeout(5000), redirect: "error" });
    const data = response.ok ? await response.json() : null;
    add("Website release", data?.gameRelease === "forever-live" ? "pass" : "fail", data?.gameRelease === "forever-live" ? "Live release confirmed" : "Live release not confirmed (HTTP " + response.status + ")");
  } catch { add("Website release", "fail", "Website unreachable or request timed out"); }
  add("Bridge logs", fs.existsSync(config.logPath) ? "pass" : "warn", fs.existsSync(config.logPath) ? "Log present; gw dev logs errors" : "No bridge log found");
  return { schemaVersion: 1, platform: process.platform, architecture: process.arch, checks };
}

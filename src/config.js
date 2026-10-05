import fs from "node:fs";
import path from "node:path";

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function loadConfig(configPath = "guildweaver-bridge.json") {
  const resolved = path.resolve(configPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const config = {
    holdfastUrl: normalizeUrl(parsed.holdfastUrl),
    memberId: String(parsed.memberId || "").trim(),
    bridgeToken: String(parsed.bridgeToken || "").trim(),
    wowRoot: parsed.wowRoot ? path.resolve(parsed.wowRoot) : null,
    savedVariablesPath: parsed.savedVariablesPath
      ? path.resolve(parsed.savedVariablesPath)
      : null,
    pollIntervalMs: Number(parsed.pollIntervalMs) || 3000,
    statePath: path.resolve(
      parsed.statePath || path.join(path.dirname(resolved), ".guildweaver-bridge-state.json"),
    ),
  };

  if (!config.holdfastUrl) {
    throw new Error("holdfastUrl is required");
  }

  if (!config.memberId) {
    throw new Error("memberId is required");
  }

  if (!config.bridgeToken) {
    throw new Error("bridgeToken is required");
  }

  if (config.pollIntervalMs < 1000) {
    throw new Error("pollIntervalMs must be at least 1000");
  }

  return config;
}

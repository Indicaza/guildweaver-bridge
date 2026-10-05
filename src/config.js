import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_HOLDFAST_URL = "https://holdfast-tddi.onrender.com";

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function appDataDirectory() {
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(),
      "Guildweaver",
    );
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Guildweaver");
  }

  return path.join(
    process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
    "guildweaver",
  );
}

export function loadConfig(configPath = "guildweaver-bridge.json") {
  const resolved = path.resolve(configPath);
  const parsed = fs.existsSync(resolved)
    ? JSON.parse(fs.readFileSync(resolved, "utf8"))
    : {};
  const dataDirectory = appDataDirectory();
  const config = {
    holdfastUrl: normalizeUrl(parsed.holdfastUrl || DEFAULT_HOLDFAST_URL),
    wowRoot: parsed.wowRoot ? path.resolve(parsed.wowRoot) : null,
    savedVariablesPath: parsed.savedVariablesPath
      ? path.resolve(parsed.savedVariablesPath)
      : null,
    pollIntervalMs: Number(parsed.pollIntervalMs) || 3000,
    dataDirectory,
    statePath: path.resolve(
      parsed.statePath || path.join(dataDirectory, "bridge-state.json"),
    ),
    credentialsPath: path.resolve(
      parsed.credentialsPath || path.join(dataDirectory, "bridge-credentials.json"),
    ),
    lockPath: path.resolve(
      parsed.lockPath || path.join(dataDirectory, "bridge.lock"),
    ),
    logPath: path.resolve(
      parsed.logPath || path.join(dataDirectory, "bridge.log"),
    ),
    backgroundLauncherPath: path.resolve(
      parsed.backgroundLauncherPath || path.join(dataDirectory, "background.vbs"),
    ),
    configPath: fs.existsSync(resolved) ? resolved : null,
  };

  if (!config.holdfastUrl) {
    throw new Error("holdfastUrl is required");
  }

  if (config.pollIntervalMs < 1000) {
    throw new Error("pollIntervalMs must be at least 1000");
  }

  return config;
}

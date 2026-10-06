import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_HOLDFAST_URL = "https://holdfast-tddi.onrender.com";
const UPDATE_CHANNELS = new Set(["edge", "beta", "stable"]);

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

function defaultBackgroundLauncherPath(dataDirectory) {
  return path.join(
    dataDirectory,
    process.platform === "win32" ? "background.vbs" : "background.sh",
  );
}

function defaultLaunchAgentPath() {
  if (process.platform !== "darwin") return null;
  return path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    "com.guildweaver.bridge.plist",
  );
}

export function loadConfig(configPath = "guildweaver-bridge.json") {
  const resolved = path.resolve(configPath);
  const parsed = fs.existsSync(resolved)
    ? JSON.parse(fs.readFileSync(resolved, "utf8"))
    : {};
  const dataDirectory = appDataDirectory();
  const holdfastUrl = normalizeUrl(parsed.holdfastUrl || DEFAULT_HOLDFAST_URL);
  const addonUpdateChannel = String(parsed.addonUpdateChannel || "edge").toLowerCase();
  const bridgeUpdateChannel = String(
    parsed.bridgeUpdateChannel || addonUpdateChannel,
  ).toLowerCase();
  const configuredLaunchAgentPath = parsed.launchAgentPath
    ? path.resolve(parsed.launchAgentPath)
    : defaultLaunchAgentPath();
  const config = {
    holdfastUrl,
    telemetryEndpoint: normalizeUrl(
      parsed.telemetryEndpoint || `${holdfastUrl}/api/bridge/telemetry`,
    ),
    wowRoot: parsed.wowRoot ? path.resolve(parsed.wowRoot) : null,
    savedVariablesPath: parsed.savedVariablesPath
      ? path.resolve(parsed.savedVariablesPath)
      : null,
    addonPath: parsed.addonPath ? path.resolve(parsed.addonPath) : null,
    addonUpdateChannel,
    bridgeUpdateChannel,
    addonUpdateIntervalMs: Number(parsed.addonUpdateIntervalMs) || 15 * 60 * 1000,
    bridgeUpdateIntervalMs: Number(parsed.bridgeUpdateIntervalMs) || 60 * 1000,
    questSyncIntervalMs: Number(parsed.questSyncIntervalMs) || 15 * 1000,
    pollIntervalMs: Number(parsed.pollIntervalMs) || 3000,
    dataDirectory,
    installDirectory: path.resolve(
      parsed.installDirectory || path.join(dataDirectory, "app"),
    ),
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
      parsed.backgroundLauncherPath || defaultBackgroundLauncherPath(dataDirectory),
    ),
    launchAgentPath: configuredLaunchAgentPath,
    configPath: fs.existsSync(resolved) ? resolved : null,
  };

  if (!config.holdfastUrl) {
    throw new Error("holdfastUrl is required");
  }

  if (config.pollIntervalMs < 1000) {
    throw new Error("pollIntervalMs must be at least 1000");
  }

  if (config.questSyncIntervalMs < 3000) {
    throw new Error("questSyncIntervalMs must be at least 3000");
  }

  if (config.addonUpdateIntervalMs < 60_000) {
    throw new Error("addonUpdateIntervalMs must be at least 60000");
  }

  if (config.bridgeUpdateIntervalMs < 30_000) {
    throw new Error("bridgeUpdateIntervalMs must be at least 30000");
  }

  if (!UPDATE_CHANNELS.has(config.addonUpdateChannel)) {
    throw new Error("addonUpdateChannel must be edge, beta, or stable");
  }

  if (!UPDATE_CHANNELS.has(config.bridgeUpdateChannel)) {
    throw new Error("bridgeUpdateChannel must be edge, beta, or stable");
  }

  return config;
}

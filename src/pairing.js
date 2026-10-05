import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function deviceName() {
  return `${os.hostname()} (${process.platform})`;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, filePath);
}

async function responseJson(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function readCredentials(credentialsPath) {
  const value = readJson(credentialsPath);

  if (!value?.deviceToken) {
    return null;
  }

  return value;
}

export function clearCredentials(credentialsPath) {
  try {
    fs.rmSync(credentialsPath, { force: true });
  } catch {
    // A missing/unremovable credential will surface naturally on the next run.
  }
}

export function openBrowser(url, spawnImpl = spawn) {
  let child;

  if (process.platform === "win32") {
    child = spawnImpl("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  } else if (process.platform === "darwin") {
    child = spawnImpl("open", [url], { detached: true, stdio: "ignore" });
  } else {
    child = spawnImpl("xdg-open", [url], { detached: true, stdio: "ignore" });
  }

  child.unref?.();
}

export async function ensurePaired(
  config,
  {
    fetchImpl = fetch,
    log = console.log,
    openBrowserImpl = openBrowser,
    sleepImpl = sleep,
  } = {},
) {
  const existing = readCredentials(config.credentialsPath);

  if (
    existing?.deviceToken &&
    String(existing.holdfastUrl || "").replace(/\/+$/, "") === config.holdfastUrl
  ) {
    return existing;
  }

  const startResponse = await fetchImpl(`${config.holdfastUrl}/api/bridge/pairing/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceName: deviceName() }),
  });
  const start = await responseJson(startResponse);

  if (!startResponse.ok || !start?.deviceCode || !start?.verificationUri) {
    throw new Error(
      `Unable to start Holdfast pairing: ${start?.error || `HTTP ${startResponse.status}`}`,
    );
  }

  log("Guildweaver needs to connect to Holdfast once.");
  log(`Opening ${start.verificationUri}`);
  log(`Pairing code: ${start.userCode}`);

  try {
    openBrowserImpl(start.verificationUri);
  } catch {
    log("Could not open your browser automatically. Open the pairing URL above.");
  }

  const intervalMs = Math.max(1000, Number(start.interval || 2) * 1000);
  const deadline = Date.now() + Math.max(30_000, Number(start.expiresIn || 600) * 1000);

  while (Date.now() < deadline) {
    const response = await fetchImpl(`${config.holdfastUrl}/api/bridge/pairing/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceCode: start.deviceCode }),
    });
    const body = await responseJson(response);

    if (response.ok && body?.status === "connected" && body?.deviceToken) {
      const credentials = {
        schemaVersion: 1,
        holdfastUrl: config.holdfastUrl,
        deviceId: body.deviceId,
        deviceToken: body.deviceToken,
        memberId: body.memberId || null,
        deviceName: body.deviceName || deviceName(),
        pairedAt: new Date().toISOString(),
      };

      writeJsonAtomic(config.credentialsPath, credentials);
      log("Guildweaver connected to Holdfast.");
      return credentials;
    }

    if (response.status === 202 || body?.status === "pending") {
      await sleepImpl(intervalMs);
      continue;
    }

    if (response.status === 410) {
      throw new Error("Holdfast pairing expired. Run Guildweaver Bridge again to retry.");
    }

    throw new Error(
      `Holdfast pairing failed: ${body?.error || `HTTP ${response.status}`}`,
    );
  }

  throw new Error("Holdfast pairing timed out. Run Guildweaver Bridge again to retry.");
}

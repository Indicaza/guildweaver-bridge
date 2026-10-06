import fs from "node:fs";
import path from "node:path";

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function readTelemetryCredentials(credentialsPath) {
  const value = readJson(credentialsPath);

  if (!value || Number(value.schemaVersion) !== 1) return null;

  const token = String(value.telemetryToken || value.token || "").trim();
  if (!token) return null;

  return {
    schemaVersion: 1,
    telemetryToken: token,
    collectorId: value.collectorId ? String(value.collectorId) : null,
    installationId: value.installationId ? String(value.installationId) : null,
    issuedAt: value.issuedAt ? String(value.issuedAt) : null,
  };
}

export function writeTelemetryCredentials(credentialsPath, credentials) {
  const token = String(credentials?.telemetryToken || credentials?.token || "").trim();
  if (!token) {
    throw new Error("telemetryToken is required");
  }

  const value = {
    schemaVersion: 1,
    telemetryToken: token,
    collectorId: credentials?.collectorId ? String(credentials.collectorId) : null,
    installationId: credentials?.installationId
      ? String(credentials.installationId)
      : null,
    issuedAt: credentials?.issuedAt || new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  const temporary = `${credentialsPath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, credentialsPath);
  return value;
}

export function clearTelemetryCredentials(credentialsPath) {
  try {
    fs.rmSync(credentialsPath, { force: true });
  } catch {
  }
}

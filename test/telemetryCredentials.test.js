import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  clearTelemetryCredentials,
  readTelemetryCredentials,
  writeTelemetryCredentials,
} from "../src/telemetryCredentials.js";

test("stores collector credentials separately from Holdfast pairing data", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-collector-"));
  const credentialsPath = path.join(directory, "telemetry-credentials.json");

  try {
    const written = writeTelemetryCredentials(credentialsPath, {
      telemetryToken: "collector_secret",
      collectorId: "collector-test",
      installationId: "install-test",
      issuedAt: "2026-10-06T04:00:00.000Z",
    });

    assert.equal(written.schemaVersion, 1);
    assert.equal(written.telemetryToken, "collector_secret");
    assert.deepEqual(readTelemetryCredentials(credentialsPath), written);

    clearTelemetryCredentials(credentialsPath);
    assert.equal(readTelemetryCredentials(credentialsPath), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ignores malformed or future collector credential files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-collector-"));
  const credentialsPath = path.join(directory, "telemetry-credentials.json");

  try {
    fs.writeFileSync(credentialsPath, "not json", "utf8");
    assert.equal(readTelemetryCredentials(credentialsPath), null);

    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({ schemaVersion: 99, telemetryToken: "future" }),
      "utf8",
    );
    assert.equal(readTelemetryCredentials(credentialsPath), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

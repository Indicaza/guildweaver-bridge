import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";

test("collector-only config disables Holdfast without changing update defaults", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-config-"));
  const configPath = path.join(directory, "guildweaver-bridge.json");

  try {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        holdfastEnabled: false,
        telemetryEndpoint: "https://collector.example/v1/telemetry/",
        telemetryCredentialsPath: path.join(directory, "collector-secret.json"),
      }),
      "utf8",
    );

    const config = loadConfig(configPath);
    assert.equal(config.holdfastEnabled, false);
    assert.equal(config.telemetryEndpoint, "https://collector.example/v1/telemetry");
    assert.equal(
      config.telemetryCredentialsPath,
      path.resolve(directory, "collector-secret.json"),
    );
    assert.equal(config.addonUpdateChannel, "edge");
    assert.equal(config.bridgeUpdateChannel, "edge");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Holdfast remains enabled by default for existing installations", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-config-"));
  const configPath = path.join(directory, "guildweaver-bridge.json");

  try {
    fs.writeFileSync(configPath, "{}\n", "utf8");
    const config = loadConfig(configPath);
    assert.equal(config.holdfastEnabled, true);
    assert.equal(config.holdfastUrl, "https://holdfast-tddi.onrender.com");
    assert.match(config.telemetryCredentialsPath, /telemetry-credentials\.json$/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

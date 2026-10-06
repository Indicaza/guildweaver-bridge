import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";

function withConfig(contents, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-config-"));
  const configPath = path.join(directory, "guildweaver-bridge.json");
  fs.writeFileSync(configPath, JSON.stringify(contents), "utf8");

  try {
    return callback(configPath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("defaults generic telemetry to the paired Holdfast oscilloscope endpoint", () => {
  withConfig({ holdfastUrl: "https://example.test/" }, (configPath) => {
    const config = loadConfig(configPath);
    assert.equal(config.holdfastUrl, "https://example.test");
    assert.equal(
      config.telemetryEndpoint,
      "https://example.test/api/bridge/telemetry",
    );
  });
});

test("allows the generic telemetry endpoint to be overridden or disabled", () => {
  withConfig(
    {
      holdfastUrl: "https://holdfast.example",
      telemetryEndpoint: "https://collector.example/v1/telemetry/",
    },
    (configPath) => {
      const config = loadConfig(configPath);
      assert.equal(
        config.telemetryEndpoint,
        "https://collector.example/v1/telemetry",
      );
    },
  );

  withConfig(
    { holdfastUrl: "https://holdfast.example", telemetryEndpoint: null },
    (configPath) => {
      const config = loadConfig(configPath);
      assert.equal(config.telemetryEndpoint, null);
    },
  );
});

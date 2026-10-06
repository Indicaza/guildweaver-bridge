import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";

test("addon updates default to one-minute polling", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-config-"));
  const configPath = path.join(root, "missing.json");

  try {
    const config = loadConfig(configPath);
    assert.equal(config.addonUpdateIntervalMs, 60_000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

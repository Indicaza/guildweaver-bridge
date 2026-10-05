import assert from "node:assert/strict";
import test from "node:test";

import {
  bridgeReleaseAssetUrls,
  ensurePackagedBridgeCurrent,
  packagedRuntime,
} from "../src/packageUpdater.js";

test("bridge release channels resolve to deterministic release assets", () => {
  assert.deepEqual(bridgeReleaseAssetUrls("edge"), {
    manifest:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/edge/release.json",
    archive:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/edge/GuildweaverBridge.zip",
    checksum:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/edge/GuildweaverBridge.zip.sha256",
  });
});

test("source checkout does not pretend to be a packaged runtime", () => {
  assert.equal(packagedRuntime(), null);
});

test("packaged updater is a no-op from a source checkout", async () => {
  const result = await ensurePackagedBridgeCurrent({
    bridgeUpdateChannel: "edge",
  });
  assert.equal(result.status, "not-packaged");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  bridgeReleaseAssetUrls,
  ensurePackagedBridgeCurrent,
  packagedRuntime,
} from "../src/packageUpdater.js";

test("Windows bridge release channels retain the legacy deterministic assets", () => {
  assert.deepEqual(bridgeReleaseAssetUrls("edge", "win32", "x64"), {
    manifest:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/edge/release.json",
    archive:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/edge/GuildweaverBridge.zip",
    checksum:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/edge/GuildweaverBridge.zip.sha256",
  });
});

test("macOS release assets are architecture-specific", () => {
  assert.deepEqual(bridgeReleaseAssetUrls("beta", "darwin", "arm64"), {
    manifest:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/beta/release.json",
    archive:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/beta/GuildweaverBridge-macos-arm64.zip",
    checksum:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/beta/GuildweaverBridge-macos-arm64.zip.sha256",
  });

  assert.deepEqual(bridgeReleaseAssetUrls("stable", "darwin", "x64"), {
    manifest:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/stable/release.json",
    archive:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/stable/GuildweaverBridge-macos-x64.zip",
    checksum:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/stable/GuildweaverBridge-macos-x64.zip.sha256",
  });
});

test("Linux release assets are architecture-specific", () => {
  assert.deepEqual(bridgeReleaseAssetUrls("edge", "linux", "x64"), {
    manifest:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/edge/release.json",
    archive:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/edge/GuildweaverBridge-linux-x64.zip",
    checksum:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/edge/GuildweaverBridge-linux-x64.zip.sha256",
  });

  assert.deepEqual(bridgeReleaseAssetUrls("beta", "linux", "arm64"), {
    manifest:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/beta/release.json",
    archive:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/beta/GuildweaverBridge-linux-arm64.zip",
    checksum:
      "https://github.com/Indicaza/guildweaver-bridge/releases/download/beta/GuildweaverBridge-linux-arm64.zip.sha256",
  });
});

test("unsupported packaged platforms are rejected", () => {
  assert.throws(
    () => bridgeReleaseAssetUrls("edge", "freebsd", "x64"),
    /Unsupported Guildweaver Bridge package platform/,
  );
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

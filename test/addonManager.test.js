import test from "node:test";
import assert from "node:assert/strict";

import {
  releaseApiUrl,
  selectReleaseAssets,
  updateDeveloperCheckout,
} from "../src/addonManager.js";

test("release channel maps to the Guildweaver GitHub release endpoint", () => {
  assert.equal(
    releaseApiUrl("edge"),
    "https://api.github.com/repos/Indicaza/guildweaver/releases/tags/edge",
  );
});

test("release assets require manifest archive and checksum", () => {
  const assets = selectReleaseAssets({
    assets: [
      { name: "release.json", browser_download_url: "manifest" },
      { name: "Guildweaver.zip", browser_download_url: "archive" },
      { name: "Guildweaver.zip.sha256", browser_download_url: "checksum" },
    ],
  });

  assert.deepEqual(assets, {
    manifest: "manifest",
    archive: "archive",
    checksum: "checksum",
  });

  assert.throws(
    () => selectReleaseAssets({ assets: [] }),
    /missing required update assets/,
  );
});

test("developer feature branch is never modified", () => {
  const calls = [];
  const execImpl = (command, args) => {
    calls.push([command, args]);
    return "feat/quest-log\n";
  };

  const result = updateDeveloperCheckout("C:/dev/guildweaver", { execImpl });

  assert.equal(result.status, "developer-branch");
  assert.equal(result.branch, "feat/quest-log");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ["rev-parse", "--abbrev-ref", "HEAD"]);
});

test("developer checkout with local changes is never modified", () => {
  const outputs = ["main", " M Core.lua\n"];
  const calls = [];
  const execImpl = (command, args) => {
    calls.push([command, args]);
    return outputs.shift();
  };

  const result = updateDeveloperCheckout("C:/dev/guildweaver", { execImpl });

  assert.equal(result.status, "developer-dirty");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1][1], ["status", "--porcelain"]);
});

test("clean developer main fast-forwards to origin main", () => {
  const outputs = ["main", "", "", "old", "new", "", "new"];
  const calls = [];
  const execImpl = (command, args) => {
    calls.push([command, args]);
    return outputs.shift();
  };

  const result = updateDeveloperCheckout("C:/dev/guildweaver", { execImpl });

  assert.equal(result.status, "developer-updated");
  assert.equal(result.commit, "new");
  assert.deepEqual(
    calls.map(([, args]) => args),
    [
      ["rev-parse", "--abbrev-ref", "HEAD"],
      ["status", "--porcelain"],
      ["fetch", "origin", "main"],
      ["rev-parse", "HEAD"],
      ["rev-parse", "origin/main"],
      ["merge", "--ff-only", "origin/main"],
      ["rev-parse", "HEAD"],
    ],
  );
});

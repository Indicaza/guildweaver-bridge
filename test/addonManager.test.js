import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureAddonCurrent,
  releaseAssetUrls,
  updateDeveloperCheckout,
} from "../src/addonManager.js";

test("release channel maps to deterministic Guildweaver download URLs", () => {
  assert.deepEqual(releaseAssetUrls("edge"), {
    manifest:
      "https://github.com/Indicaza/guildweaver/releases/download/edge/release.json",
    archive:
      "https://github.com/Indicaza/guildweaver/releases/download/edge/Guildweaver.zip",
    checksum:
      "https://github.com/Indicaza/guildweaver/releases/download/edge/Guildweaver.zip.sha256",
  });
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

test("normal install verifies checksum and installs staged release", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-addon-test-"));
  const addonPath = path.join(root, "Interface", "AddOns", "Guildweaver");
  const dataDirectory = path.join(root, "data");
  const manifest = {
    schemaVersion: 1,
    addonVersion: "0.2.0-alpha.1",
    releaseVersion: "0.2.0-alpha.1+edge.12345678",
    channel: "edge",
    commit: "1234567890abcdef",
    savedVariablesSchema: 2,
    bridgeProtocol: 1,
  };
  const archive = Buffer.from("fake-guildweaver-archive");
  const checksum = crypto.createHash("sha256").update(archive).digest("hex");
  const urls = releaseAssetUrls("edge");
  const fetchImpl = async (url) => {
    if (url === urls.manifest) {
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    if (url === urls.archive) {
      return new Response(archive, { status: 200 });
    }
    if (url === urls.checksum) {
      return new Response(`${checksum}\n`, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
  const extractArchive = (archivePath, destinationPath) => {
    assert.equal(fs.readFileSync(archivePath, "utf8"), archive.toString("utf8"));
    const staged = path.join(destinationPath, "Guildweaver");
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, "Guildweaver.toc"), "## Interface: 16001\n");
    fs.writeFileSync(
      path.join(staged, "release.json"),
      `${JSON.stringify(manifest)}\n`,
    );
  };

  try {
    const result = await ensureAddonCurrent(
      {
        addonPath,
        addonUpdateChannel: "edge",
        dataDirectory,
      },
      { fetchImpl, extractArchive },
    );

    assert.equal(result.status, "updated");
    assert.equal(result.commit, manifest.commit);
    assert.ok(fs.existsSync(path.join(addonPath, "Guildweaver.toc")));
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(addonPath, "release.json"), "utf8")).commit,
      manifest.commit,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

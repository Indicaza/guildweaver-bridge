import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { findAddonPath } from "./discovery.js";

const RELEASE_DOWNLOAD_ROOT =
  "https://github.com/Indicaza/guildweaver/releases/download";
const SUPPORTED_BRIDGE_PROTOCOL = 2;

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function jsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

async function responseText(response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

async function responseJson(response) {
  const text = await responseText(response);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Release metadata was not valid JSON");
  }
}

export function releaseAssetUrls(channel) {
  const base = `${RELEASE_DOWNLOAD_ROOT}/${encodeURIComponent(channel)}`;
  return {
    manifest: `${base}/release.json`,
    archive: `${base}/Guildweaver.zip`,
    checksum: `${base}/Guildweaver.zip.sha256`,
  };
}

function developerCheckout(addonPath) {
  if (!fs.existsSync(addonPath)) {
    return null;
  }

  const realPath = fs.realpathSync.native(addonPath);
  const redirected = normalizePath(realPath) !== normalizePath(addonPath);
  const gitPath = path.join(realPath, ".git");

  if ((redirected || fs.existsSync(gitPath)) && fs.existsSync(gitPath)) {
    return realPath;
  }

  return null;
}

function runGit(cwd, args, execImpl = execFileSync) {
  return String(
    execImpl("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }) || "",
  ).trim();
}

export function updateDeveloperCheckout(checkoutPath, { execImpl = execFileSync } = {}) {
  const branch = runGit(
    checkoutPath,
    ["rev-parse", "--abbrev-ref", "HEAD"],
    execImpl,
  );

  if (branch !== "main") {
    return { status: "developer-branch", path: checkoutPath, branch };
  }

  const dirty = runGit(checkoutPath, ["status", "--porcelain"], execImpl);

  if (dirty) {
    return { status: "developer-dirty", path: checkoutPath };
  }

  runGit(checkoutPath, ["fetch", "origin", "main"], execImpl);
  const before = runGit(checkoutPath, ["rev-parse", "HEAD"], execImpl);
  const remote = runGit(checkoutPath, ["rev-parse", "origin/main"], execImpl);

  if (before === remote) {
    return { status: "developer-current", path: checkoutPath, commit: before };
  }

  runGit(checkoutPath, ["merge", "--ff-only", "origin/main"], execImpl);
  const after = runGit(checkoutPath, ["rev-parse", "HEAD"], execImpl);
  return { status: "developer-updated", path: checkoutPath, commit: after };
}

function escapePowerShellLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function extractArchiveDefault(archivePath, destinationPath) {
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${escapePowerShellLiteral(archivePath)}' -DestinationPath '${escapePowerShellLiteral(destinationPath)}' -Force`,
      ],
      { stdio: "ignore" },
    );
    return;
  }

  execFileSync("unzip", ["-q", archivePath, "-d", destinationPath], {
    stdio: "ignore",
  });
}

function replaceAddonDirectory(addonPath, stagedAddonPath) {
  const backupPath = `${addonPath}.guildweaver-backup`;
  fs.mkdirSync(path.dirname(addonPath), { recursive: true });
  fs.rmSync(backupPath, { recursive: true, force: true });
  const hadExisting = fs.existsSync(addonPath);

  try {
    if (hadExisting) {
      fs.renameSync(addonPath, backupPath);
    }
    fs.renameSync(stagedAddonPath, addonPath);
    fs.rmSync(backupPath, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(addonPath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, addonPath);
    }
    throw error;
  }
}

export async function ensureAddonCurrent(
  config,
  {
    fetchImpl = fetch,
    execImpl = execFileSync,
    extractArchive = extractArchiveDefault,
  } = {},
) {
  const addonPath = findAddonPath(config);
  const checkout = developerCheckout(addonPath);

  if (checkout) {
    return updateDeveloperCheckout(checkout, { execImpl });
  }

  const assets = releaseAssetUrls(config.addonUpdateChannel);
  const manifestResponse = await fetchImpl(assets.manifest);

  if (manifestResponse.status === 404) {
    return { status: "release-unavailable", channel: config.addonUpdateChannel };
  }

  const manifest = await responseJson(manifestResponse);

  if (Number(manifest.schemaVersion) !== 1) {
    throw new Error("Unsupported Guildweaver release manifest schema");
  }

  if (Number(manifest.bridgeProtocol) > SUPPORTED_BRIDGE_PROTOCOL) {
    throw new Error(
      `Guildweaver requires bridge protocol ${manifest.bridgeProtocol}; this bridge supports ${SUPPORTED_BRIDGE_PROTOCOL}`,
    );
  }

  const installed = jsonFile(path.join(addonPath, "release.json"));
  if (installed?.commit && installed.commit === manifest.commit) {
    return {
      status: "current",
      path: addonPath,
      releaseVersion: manifest.releaseVersion,
      commit: manifest.commit,
    };
  }

  fs.mkdirSync(config.dataDirectory, { recursive: true });
  const downloadRoot = fs.mkdtempSync(path.join(config.dataDirectory, "addon-download-"));
  const archivePath = path.join(downloadRoot, "Guildweaver.zip");
  const addonParent = path.dirname(addonPath);
  fs.mkdirSync(addonParent, { recursive: true });
  const extractionRoot = path.join(
    addonParent,
    `.guildweaver-update-${process.pid}-${Date.now()}`,
  );

  try {
    const archiveResponse = await fetchImpl(assets.archive);
    if (!archiveResponse.ok) {
      throw new Error(`Unable to download Guildweaver: HTTP ${archiveResponse.status}`);
    }
    fs.writeFileSync(archivePath, Buffer.from(await archiveResponse.arrayBuffer()));

    const expectedChecksum = (await responseText(await fetchImpl(assets.checksum)))
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();
    const actualChecksum = sha256File(archivePath);

    if (!expectedChecksum || expectedChecksum !== actualChecksum) {
      throw new Error("Guildweaver update checksum did not match");
    }

    fs.mkdirSync(extractionRoot, { recursive: true });
    extractArchive(archivePath, extractionRoot);

    const stagedAddonPath = path.join(extractionRoot, "Guildweaver");
    const stagedToc = path.join(stagedAddonPath, "Guildweaver.toc");
    const stagedManifest = jsonFile(path.join(stagedAddonPath, "release.json"));

    if (!fs.existsSync(stagedToc) || stagedManifest?.commit !== manifest.commit) {
      throw new Error("Guildweaver update package failed validation");
    }

    replaceAddonDirectory(addonPath, stagedAddonPath);

    return {
      status: fs.existsSync(path.join(addonPath, "Guildweaver.toc")) ? "updated" : "failed",
      path: addonPath,
      releaseVersion: manifest.releaseVersion,
      commit: manifest.commit,
    };
  } finally {
    fs.rmSync(downloadRoot, { recursive: true, force: true });
    fs.rmSync(extractionRoot, { recursive: true, force: true });
  }
}

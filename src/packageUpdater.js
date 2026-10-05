import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stopLockedInstance } from "./instanceLock.js";

const RELEASE_DOWNLOAD_ROOT =
  "https://github.com/Indicaza/guildweaver-bridge/releases/download";

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function appRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function runtimeBinaryName(platform = process.platform) {
  return platform === "win32" ? "node.exe" : "node";
}

function releaseAssetNames(platform = process.platform, arch = process.arch) {
  if (platform === "win32" && arch === "x64") {
    return {
      archive: "GuildweaverBridge.zip",
      checksum: "GuildweaverBridge.zip.sha256",
    };
  }

  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return {
      archive: `GuildweaverBridge-macos-${arch}.zip`,
      checksum: `GuildweaverBridge-macos-${arch}.zip.sha256`,
    };
  }

  if (platform === "linux" && (arch === "arm64" || arch === "x64")) {
    return {
      archive: `GuildweaverBridge-linux-${arch}.zip`,
      checksum: `GuildweaverBridge-linux-${arch}.zip.sha256`,
    };
  }

  throw new Error(`Unsupported Guildweaver Bridge package platform: ${platform}-${arch}`);
}

export function packagedRuntime() {
  const applicationRoot = appRoot();
  const packageRoot = path.dirname(applicationRoot);
  const releasePath = path.join(applicationRoot, "release.json");
  const nodePath = path.join(packageRoot, runtimeBinaryName());

  if (!fs.existsSync(releasePath) || !fs.existsSync(nodePath)) {
    return null;
  }

  try {
    const release = JSON.parse(fs.readFileSync(releasePath, "utf8"));
    return {
      applicationRoot,
      packageRoot,
      releasePath,
      nodePath,
      release,
    };
  } catch {
    return null;
  }
}

export function bridgeReleaseAssetUrls(
  channel,
  platform = process.platform,
  arch = process.arch,
) {
  const base = `${RELEASE_DOWNLOAD_ROOT}/${encodeURIComponent(channel)}`;
  const assets = releaseAssetNames(platform, arch);
  return {
    manifest: `${base}/release.json`,
    archive: `${base}/${assets.archive}`,
    checksum: `${base}/${assets.checksum}`,
  };
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
    throw new Error("Bridge release metadata was not valid JSON");
  }
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
      { stdio: "ignore", windowsHide: true },
    );
    return;
  }

  execFileSync("unzip", ["-q", archivePath, "-d", destinationPath], {
    stdio: "ignore",
  });
}

function validatePackageRoot(packageRoot, expectedCommit = null) {
  const nodePath = path.join(packageRoot, runtimeBinaryName());
  const cliPath = path.join(packageRoot, "app", "src", "cli.js");
  const releasePath = path.join(packageRoot, "app", "release.json");

  if (!fs.existsSync(nodePath) || !fs.existsSync(cliPath) || !fs.existsSync(releasePath)) {
    throw new Error("Guildweaver Bridge package is incomplete");
  }

  if (process.platform !== "win32") {
    fs.chmodSync(nodePath, 0o755);
  }

  const release = JSON.parse(fs.readFileSync(releasePath, "utf8"));
  if (Number(release.schemaVersion) !== 1) {
    throw new Error("Unsupported Guildweaver Bridge package schema");
  }

  if (expectedCommit && release.commit !== expectedCommit) {
    throw new Error("Guildweaver Bridge package commit did not match release metadata");
  }

  return { nodePath, cliPath, release };
}

function replaceDirectory(targetPath, stagedPath) {
  const backupPath = `${targetPath}.backup`;
  fs.rmSync(backupPath, { recursive: true, force: true });

  try {
    if (fs.existsSync(targetPath)) {
      fs.renameSync(targetPath, backupPath);
    }
    fs.renameSync(stagedPath, targetPath);
    fs.rmSync(backupPath, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(targetPath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, targetPath);
    }
    throw error;
  }
}

export function installPackagedBridge(config, { packageRoot = path.dirname(process.execPath) } = {}) {
  if (!["win32", "darwin", "linux"].includes(process.platform)) {
    throw new Error("Packaged Guildweaver Bridge installation supports Windows, macOS, and Linux only");
  }

  const source = validatePackageRoot(packageRoot);
  const target = config.installDirectory;

  if (normalizePath(packageRoot) === normalizePath(target)) {
    return {
      status: "already-installed",
      path: target,
      nodePath: source.nodePath,
      cliPath: source.cliPath,
      release: source.release,
    };
  }

  stopLockedInstance(config.lockPath);

  const staged = `${target}.installing`;
  fs.rmSync(staged, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(packageRoot, staged, { recursive: true });
  validatePackageRoot(staged, source.release.commit);
  replaceDirectory(target, staged);

  const installed = validatePackageRoot(target, source.release.commit);
  return {
    status: "installed",
    path: target,
    ...installed,
  };
}

export async function ensurePackagedBridgeCurrent(
  config,
  { fetchImpl = fetch, extractArchive = extractArchiveDefault } = {},
) {
  const runtime = packagedRuntime();
  if (!runtime) {
    return { status: "not-packaged" };
  }

  if (normalizePath(runtime.packageRoot) !== normalizePath(config.installDirectory)) {
    return { status: "package-not-installed", path: runtime.packageRoot };
  }

  const assets = bridgeReleaseAssetUrls(config.bridgeUpdateChannel);
  const manifestResponse = await fetchImpl(assets.manifest);
  if (manifestResponse.status === 404) {
    return { status: "release-unavailable", channel: config.bridgeUpdateChannel };
  }

  const manifest = await responseJson(manifestResponse);
  if (Number(manifest.schemaVersion) !== 1) {
    throw new Error("Unsupported Guildweaver Bridge release manifest schema");
  }

  if (runtime.release?.commit && runtime.release.commit === manifest.commit) {
    return {
      status: "package-current",
      commit: manifest.commit,
      releaseVersion: manifest.releaseVersion,
    };
  }

  fs.mkdirSync(config.dataDirectory, { recursive: true });
  const downloadRoot = fs.mkdtempSync(path.join(config.dataDirectory, "bridge-download-"));
  const archivePath = path.join(downloadRoot, path.basename(new URL(assets.archive).pathname));
  const extractionRoot = path.join(downloadRoot, "extracted");
  const nextPath = `${config.installDirectory}.next`;

  try {
    const archiveResponse = await fetchImpl(assets.archive);
    if (!archiveResponse.ok) {
      throw new Error(`Unable to download Guildweaver Bridge: HTTP ${archiveResponse.status}`);
    }
    fs.writeFileSync(archivePath, Buffer.from(await archiveResponse.arrayBuffer()));

    const expectedChecksum = (await responseText(await fetchImpl(assets.checksum)))
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();
    const actualChecksum = sha256File(archivePath);
    if (!expectedChecksum || expectedChecksum !== actualChecksum) {
      throw new Error("Guildweaver Bridge update checksum did not match");
    }

    fs.mkdirSync(extractionRoot, { recursive: true });
    extractArchive(archivePath, extractionRoot);

    const extractedPackage = path.join(extractionRoot, "GuildweaverBridge");
    validatePackageRoot(extractedPackage, manifest.commit);

    fs.rmSync(nextPath, { recursive: true, force: true });
    fs.cpSync(extractedPackage, nextPath, { recursive: true });
    validatePackageRoot(nextPath, manifest.commit);

    return {
      status: "package-update-staged",
      nextPath,
      commit: manifest.commit,
      previousCommit: runtime.release?.commit || null,
      releaseVersion: manifest.releaseVersion,
    };
  } finally {
    fs.rmSync(downloadRoot, { recursive: true, force: true });
  }
}

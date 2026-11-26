#!/usr/bin/env node

import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startAgent } from "./agent.js";
import { normalizeDomains } from "./domains.js";
import { notify } from "./notifications.js";
import { debugEnabled } from "./cli/logs.js";
import process from "node:process";

import { ensureAddonCurrent } from "./addonManager.js";
import { runArchiveCommand } from "./archive.js";
import { installCli } from "./cli/install.js";
import {
  backgroundStatus as nativeBackgroundStatus,
  installBackground as installNativeBackground,
  scheduleBackgroundRestart as scheduleNativeBackgroundRestart,
  schedulePackageReplacement as scheduleNativePackageReplacement,
  uninstallBackground as uninstallNativeBackground,
} from "./background.js";
import { createLiveServerCheck } from "./liveServer.js";
import { createBackpressure } from "./backpressure.js";
import { loadConfig } from "./config.js";
import { acquireInstanceLock } from "./instanceLock.js";
import {
  backgroundStatus as linuxBackgroundStatus,
  installBackground as installLinuxBackground,
  scheduleBackgroundRestart as scheduleLinuxBackgroundRestart,
  schedulePackageReplacement as scheduleLinuxPackageReplacement,
  uninstallBackground as uninstallLinuxBackground,
} from "./linuxBackground.js";
import { enableFileLogging } from "./logger.js";
import {
  ensurePackagedBridgeCurrent,
  packagedRuntime,
  installPackagedBridge,
} from "./packageUpdater.js";
import { clearCredentials, ensurePaired } from "./pairing.js";
import { updateBridgeSource } from "./sourceUpdater.js";
import { syncOnce } from "./sync.js";
import { isWowRunning } from "./wowProcess.js";

const WOW_PROCESS_POLL_INTERVAL_MS = 5000;

const platformBackground =
  process.platform === "linux"
    ? {
        backgroundStatus: linuxBackgroundStatus,
        installBackground: installLinuxBackground,
        scheduleBackgroundRestart: scheduleLinuxBackgroundRestart,
        schedulePackageReplacement: scheduleLinuxPackageReplacement,
        uninstallBackground: uninstallLinuxBackground,
      }
    : {
        backgroundStatus: nativeBackgroundStatus,
        installBackground: installNativeBackground,
        scheduleBackgroundRestart: scheduleNativeBackgroundRestart,
        schedulePackageReplacement: scheduleNativePackageReplacement,
        uninstallBackground: uninstallNativeBackground,
      };

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function usage() {
  console.log(`Guildweaver Bridge

Usage:
  node src/cli.js once [--config path]
  node src/cli.js watch [--config path]
  node src/cli.js pair [--config path]
  node src/cli.js install-background [--config path]
  node src/cli.js uninstall-background [--config path]
  node src/cli.js background-status [--config path]
  node src/cli.js archive status [--config path]
  node src/cli.js archive pull --dataset DATASET --market KEY --out FILE.json.gz [--cursor CURSOR]

Commands:
  once                 Update Guildweaver, pair if needed, then sync once.
  watch                Keep Guildweaver updated and watch SavedVariables.
  pair                 Connect this computer to Holdfast and exit.
  install-background   Install/update the addon and run the bridge at login.
  uninstall-background Stop it and remove startup registration.
  background-status    Show whether the background bridge is installed/running.
  archive status       Inspect this computer’s archive authorization and available markets.
  archive pull         Explicitly download one verified batch; never automatic.

A config file is optional. Standard WoW installs and Holdfast production are discovered automatically.
`);
}

function describeAddonUpdate(result) {
  if (!result) return null;

  if (result.status === "updated") {
    return `Guildweaver addon updated to ${result.releaseVersion || result.commit || "latest"}.`;
  }
  if (result.status === "developer-updated") {
    return `Guildweaver developer checkout fast-forwarded to ${String(result.commit || "latest").slice(0, 8)}.`;
  }
  if (result.status === "developer-branch") {
    return `Guildweaver developer checkout is on ${result.branch}; automatic update only touches main.`;
  }
  if (result.status === "developer-dirty") {
    return "Guildweaver developer checkout has local changes; automatic update skipped.";
  }
  if (result.status === "release-unavailable") {
    return `Guildweaver ${result.channel} release is not published yet.`;
  }

  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "watch";
  const backgroundMode = args.includes("--background");

  if (command === "help" || args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }

  const commands = new Set([
    "once",
    "watch",
    "pair",
    "install-package",
    "install-background",
    "uninstall-background",
    "background-status",
    "archive",
  ]);

  if (!commands.has(command)) {
    usage();
    process.exitCode = 1;
    return;
  }

  const configPath = optionValue(args, "--config") || "guildweaver-bridge.json";
  const config = loadConfig(configPath);

  if (command === "archive") {
    await runArchiveCommand(config, args.slice(1));
    return;
  }

  if (command === "install-package") {
    const installed = installPackagedBridge(config);
    const childArgs = [installed.cliPath, "install-background"];
    if (config.configPath) {
      childArgs.push("--config", config.configPath);
    }
    const result = spawnSync(installed.nodePath, childArgs, {
      stdio: "inherit",
      windowsHide: process.platform === "win32",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Installed Guildweaver Bridge exited with code ${result.status}`);
    }
    console.log("Guildweaver Bridge installation complete. You can delete the downloaded archive.");
    return;
  }

  if (backgroundMode) {
    enableFileLogging(config.logPath);
  }

  if (command === "uninstall-background") {
    platformBackground.uninstallBackground(config);
    console.log("Guildweaver background bridge removed.");
    return;
  }

  if (command === "background-status") {
    const status = platformBackground.backgroundStatus(config);
    console.log(
      `Guildweaver background bridge: ${status.installed ? "installed" : "not installed"}, ${status.running ? `running (PID ${status.pid})` : "not running"}.`,
    );
    console.log(`Log: ${status.logPath}`);
    return;
  }

  if (command === "install-background") {
    const credentials = await ensurePaired(config);
    const addonResult = await ensureAddonCurrent(config);
    const addonMessage = describeAddonUpdate(addonResult);
    if (addonMessage) console.log(addonMessage);
    const installed = platformBackground.installBackground(config);
    const binDirectory = installCli(config);
    console.log(`Guildweaver CLI installed in ${binDirectory}; add that directory to PATH to use gw.`);
    console.log(`Guildweaver is connected as Holdfast member ${credentials.memberId || "unknown"}.`);
    console.log("Guildweaver addon is installed and automatic updates are enabled.");
    console.log("Background sync installed and started. It will launch automatically when you sign in.");
    console.log(`Log: ${installed.logPath}`);
    return;
  }

  let releaseInstanceLock = null;
  let manualInFlight = false;
  let closeAgent = null;
  const updateMarker = config.lockPath + ".update.json";
  const announce = async (title, message) => {
    console.log(`${title}: ${message}`);
    const result = await notify(config, title, message);
    if (result.status === "unavailable") console.log("Desktop notification unavailable; event retained in bridge log.");
  };

  if (command === "watch") {
    releaseInstanceLock = acquireInstanceLock(config.lockPath);

    if (!releaseInstanceLock) {
      if (!backgroundMode) {
        console.log("Guildweaver Bridge is already running in the background.");
      }
      return;
    }
  }

  const releaseLock = () => {
    releaseInstanceLock?.();
    releaseInstanceLock = null;
  };

  const checkBridgeUpdate = async () => {
    if (!backgroundMode && !manualInFlight) return null;

    try {
      const sourceResult = updateBridgeSource();
      if (sourceResult.status !== "not-source-checkout") {
        return sourceResult;
      }
      return await ensurePackagedBridgeCurrent(config);
    } catch (error) {
      if (manualInFlight) throw error;
      console.error(`Guildweaver Bridge self-update: ${error.message}`);
      return null;
    }
  };

  const restartIntoUpdatedBridge = (result) => {
    fs.mkdirSync(path.dirname(updateMarker), { recursive: true });
    fs.writeFileSync(updateMarker, JSON.stringify({ commit: result.commit, releaseVersion: result.releaseVersion || null }), { mode: 0o600 });
    closeAgent?.();
    closeAgent = null;
    if (result.status === "package-update-staged") {
      console.log(
        `Guildweaver Bridge package updated ${String(result.previousCommit || "").slice(0, 8)} -> ${String(result.commit || "").slice(0, 8)}. Restarting...`,
      );
      platformBackground.schedulePackageReplacement(config, result.nextPath);
      releaseLock();
      return;
    }

    console.log(
      `Guildweaver Bridge updated ${String(result.previousCommit || "").slice(0, 8)} -> ${String(result.commit || "").slice(0, 8)}. Restarting...`,
    );
    platformBackground.scheduleBackgroundRestart(config);
    releaseLock();
  };

  const startupBridgeUpdate = await checkBridgeUpdate();
  if (
    startupBridgeUpdate?.status === "updated" ||
    startupBridgeUpdate?.status === "package-update-staged"
  ) {
    restartIntoUpdatedBridge(startupBridgeUpdate);
    return;
  }

  let addonUpdateInFlight = false;
  const updateAddon = async () => {
    if (addonUpdateInFlight || manualInFlight) return;
    addonUpdateInFlight = true;

    try {
      const result = await ensureAddonCurrent(config);
      const message = describeAddonUpdate(result);
      if (message) console.log(message);
      if (["updated", "developer-updated"].includes(result?.status)) await announce("Guildweaver addon updated", `${result.releaseVersion || result.commit?.slice(0, 8) || "New build"} installed. Reload WoW to load it.`);
    } catch (error) {
      console.error(`Guildweaver addon update: ${error.message}`);
    } finally {
      addonUpdateInFlight = false;
    }
  };

  await updateAddon();

  let credentials = null;
  let runtimeConfig = null;

  const pairRuntime = async () => {
    credentials = await ensurePaired(config);
    runtimeConfig = {
      ...config,
      deviceToken: credentials.deviceToken,
    };
  };

  await pairRuntime();
  if (command === "watch" && backgroundMode) {
    try { installCli(config); } catch (error) { console.error("CLI launcher unavailable: " + error.message); }
  }

  if (command === "pair") {
    console.log(`Connected as Holdfast member ${credentials.memberId || "unknown"}.`);
    return;
  }

  const backpressure = createBackpressure();
  const checkLiveServer = createLiveServerCheck(config, { fetchImpl: backpressure.fetch });
  const syncWithRepair = async ({ reconcileState = false, domains = [], manual = false } = {}) => {
    backpressure.check();
    const trace = debugEnabled(config) ? (event) => console.log(JSON.stringify(event)) : null;
    await checkLiveServer();
    try {
      return await syncOnce(runtimeConfig, { reconcileState, domains, manual, trace, fetchImpl: backpressure.fetch });
    } catch (error) {
      if (!String(error?.message || "").includes("invalid_device_token")) {
        throw error;
      }

      console.log("Holdfast connection expired or was revoked. Reconnecting…");
      if (manual) throw error;
      clearCredentials(config.credentialsPath);
      await pairRuntime();
      return syncOnce(runtimeConfig, { reconcileState, domains, manual, trace, fetchImpl: backpressure.fetch });
    }
  };

  let syncInFlight = false;
  let reconcileRequested = true;
  let lastStateReconcileAt = 0;
  let consecutiveFailures = 0;
  let retryAt = 0;

  const run = async ({ reconcileState = false } = {}) => {
    if (reconcileState) reconcileRequested = true;
    if (syncInFlight || manualInFlight || Date.now() < retryAt) return false;

    syncInFlight = true;
    const shouldReconcile = reconcileRequested;
    if (shouldReconcile) reconcileRequested = false;

    try {
      const result = await syncWithRepair({ reconcileState: shouldReconcile });
      if (shouldReconcile) lastStateReconcileAt = Date.now();
      if (result.transientUploadFailure || result.questSyncFailed || result.lootSync === "failed") {
        consecutiveFailures += 1;
        retryAt = Date.now() + Math.max(backpressure.remainingMs(), Math.min(60_000, 2_000 * 2 ** Math.min(consecutiveFailures - 1, 5)) + Math.floor(Math.random() * 2000));
      } else {
        consecutiveFailures = 0;
        retryAt = 0;
      }

      if (
        result.telemetrySent > 0 || result.telemetryFailed > 0 || result.questSyncFailed ||
        shouldReconcile ||
        command === "once"
      ) {
        console.log(
          `Scan complete: ${result.files} file(s), ${result.telemetrySent} telemetry record(s), ${result.telemetrySkipped} skipped, ${result.telemetryDeferred} deferred, ${result.telemetryFailed} failed, ${result.telemetryRejected} rejected, ${result.unreadableFiles} unreadable file(s), ${result.blockedFiles} validation-blocked file(s)${shouldReconcile ? ", state reconciled" : ""}.`,
        );
      }
      return true;
    } catch (error) {
      if (shouldReconcile) reconcileRequested = true;
      consecutiveFailures += 1;
      retryAt = Date.now() + Math.max(backpressure.remainingMs(), Math.min(60_000, 2_000 * 2 ** Math.min(consecutiveFailures - 1, 5)) + Math.floor(Math.random() * 2000));
      console.error(`Guildweaver Bridge: ${error.message}`);

      if (command === "once") {
        process.exitCode = 1;
      }
      return false;
    } finally {
      syncInFlight = false;
    }
  };

  await run({ reconcileState: true });

  if (command === "watch") {
    try {
      const pending = JSON.parse(fs.readFileSync(updateMarker, "utf8"));
      const commit = packagedRuntime()?.release?.commit || execFileSync("git", ["rev-parse", "HEAD"], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
      if (pending.commit && pending.commit === commit) {
        fs.rmSync(updateMarker, { force: true });
        await announce("Guildweaver bridge updated", `${pending.releaseVersion || commit.slice(0, 8)} is running.`);
      }
    } catch {}
  }

  if (command === "once") {
    return;
  }

  console.log(
    `Watching Guildweaver SavedVariables every ${config.pollIntervalMs}ms; reconciling current state every ${Math.round(config.stateReconcileIntervalMs / 60000)}m.`,
  );

  await new Promise((resolve) => {
    let stopping = false;
    let bridgeUpdatePromise = null;
    let wowWasRunning = isWowRunning();
    let bridgeUpdateTimer = null;
    let wowProcessTimer = null;

    const syncTimer = setInterval(() => {
      const reconcileState =
        Date.now() - lastStateReconcileAt >= config.stateReconcileIntervalMs;
      void run({ reconcileState });
    }, config.pollIntervalMs);
    const addonUpdateTimer = setInterval(updateAddon, config.addonUpdateIntervalMs);

    const clearWatchTimers = () => {
      clearInterval(syncTimer);
      clearInterval(addonUpdateTimer);
      if (bridgeUpdateTimer) clearInterval(bridgeUpdateTimer);
      if (wowProcessTimer) clearInterval(wowProcessTimer);
    };

    const checkBridgeAndRestart = () => {
      if (stopping || manualInFlight || syncInFlight || addonUpdateInFlight) return Promise.resolve(false);
      if (bridgeUpdatePromise) return bridgeUpdatePromise;

      bridgeUpdatePromise = (async () => {
        const result = await checkBridgeUpdate();
        if (
          result?.status === "updated" ||
          result?.status === "package-update-staged"
        ) {
          stopping = true;
          clearWatchTimers();
          restartIntoUpdatedBridge(result);
          resolve();
          return true;
        }
        return false;
      })().finally(() => {
        bridgeUpdatePromise = null;
      });

      return bridgeUpdatePromise;
    };

    const stop = () => {
      if (stopping) return;
      stopping = true;
      clearWatchTimers();
      closeAgent?.();
      closeAgent = null;
      releaseLock();
      resolve();
    };

    bridgeUpdateTimer = setInterval(() => {
      void checkBridgeAndRestart();
    }, config.bridgeUpdateIntervalMs);

    wowProcessTimer = setInterval(async () => {
      if (stopping) return;

      const wowRunning = isWowRunning();
      const justStarted = wowRunning && !wowWasRunning;
      wowWasRunning = wowRunning;

      if (!justStarted) return;

      console.log("World of Warcraft started; checking Guildweaver updates.");
      const restarted = await checkBridgeAndRestart();
      if (!restarted && !stopping) {
        await updateAddon();
        await run({ reconcileState: true });
      }
    }, WOW_PROCESS_POLL_INTERVAL_MS);

    void startAgent(config, async (operation, args) => {
      if (operation === "ping" && Array.isArray(args) && args.length === 0) return { ready: !stopping };
      if (stopping || manualInFlight || syncInFlight || addonUpdateInFlight || bridgeUpdatePromise) throw new Error("Bridge busy; retry in a moment.");
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new Error("Invalid command arguments");
      manualInFlight = true;
      try {
        if (operation === "sync") {
          normalizeDomains(args);
          const result = await syncWithRepair({ domains: args, manual: true });
          result.retryAfterSeconds = Math.ceil(backpressure.remainingMs() / 1000);
          console.log("Manual synchronization complete: " + JSON.stringify(result));
          return result;
        }
        if (operation === "update") {
          if (args.length !== 1 || !["all", "addon", "bridge"].includes(args[0])) throw new Error("Choose addon, bridge or all");
          const result = {};
          if (args[0] !== "bridge") {
            result.addon = await ensureAddonCurrent(config);
            if (["updated", "developer-updated"].includes(result.addon?.status)) {
              await announce("Guildweaver addon updated", (result.addon.releaseVersion || result.addon.commit?.slice(0, 8) || "New build") + " installed. Reload WoW to load it.");
            }
          }
          if (args[0] !== "addon") {
            result.bridge = await checkBridgeUpdate();
            if (["updated", "package-update-staged"].includes(result.bridge?.status)) {
              stopping = true;
              clearWatchTimers();
              const replacement = result.bridge;
              setTimeout(() => {
                try { restartIntoUpdatedBridge(replacement); resolve(); }
                catch (error) { console.error("Bridge restart failed: " + error.message); releaseLock(); resolve(); }
              }, 250);
              result.bridge = { status: "restart-scheduled", commit: replacement.commit, releaseVersion: replacement.releaseVersion };
            }
          }
          return result;
        }
        throw new Error("Unknown agent operation");
      } finally { manualInFlight = false; }
    }).then((close) => {
      if (stopping) close();
      else closeAgent = close;
    }).catch((error) => console.error("Local command agent unavailable: " + error.message));

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

main().catch((error) => {
  console.error(`Guildweaver Bridge: ${error.message}`);
  process.exitCode = 1;
});

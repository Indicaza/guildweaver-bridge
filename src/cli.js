#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

import { ensureAddonCurrent } from "./addonManager.js";
import {
  backgroundStatus as nativeBackgroundStatus,
  installBackground as installNativeBackground,
  scheduleBackgroundRestart as scheduleNativeBackgroundRestart,
  schedulePackageReplacement as scheduleNativePackageReplacement,
  uninstallBackground as uninstallNativeBackground,
} from "./background.js";
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

Commands:
  once                 Update Guildweaver, pair if needed, then sync once.
  watch                Keep Guildweaver updated and watch SavedVariables.
  pair                 Connect this computer to Holdfast and exit.
  install-background   Install/update the addon and run the bridge at login.
  uninstall-background Stop it and remove startup registration.
  background-status    Show whether the background bridge is installed/running.

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
  ]);

  if (!commands.has(command)) {
    usage();
    process.exitCode = 1;
    return;
  }

  const configPath = optionValue(args, "--config") || "guildweaver-bridge.json";
  const config = loadConfig(configPath);

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
    console.log(`Guildweaver is connected as Holdfast member ${credentials.memberId || "unknown"}.`);
    console.log("Guildweaver addon is installed and automatic updates are enabled.");
    console.log("Background sync installed and started. It will launch automatically when you sign in.");
    console.log(`Log: ${installed.logPath}`);
    return;
  }

  let releaseInstanceLock = null;

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
    if (!backgroundMode) return null;

    try {
      const sourceResult = updateBridgeSource();
      if (sourceResult.status !== "not-source-checkout") {
        return sourceResult;
      }
      return await ensurePackagedBridgeCurrent(config);
    } catch (error) {
      console.error(`Guildweaver Bridge self-update: ${error.message}`);
      return null;
    }
  };

  const restartIntoUpdatedBridge = (result) => {
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
    if (addonUpdateInFlight) return;
    addonUpdateInFlight = true;

    try {
      const result = await ensureAddonCurrent(config);
      const message = describeAddonUpdate(result);
      if (message) console.log(message);
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

  if (command === "pair") {
    console.log(`Connected as Holdfast member ${credentials.memberId || "unknown"}.`);
    return;
  }

  const syncWithRepair = async () => {
    try {
      return await syncOnce(runtimeConfig);
    } catch (error) {
      if (!String(error?.message || "").includes("invalid_device_token")) {
        throw error;
      }

      console.log("Holdfast connection expired or was revoked. Reconnecting…");
      clearCredentials(config.credentialsPath);
      await pairRuntime();
      return syncOnce(runtimeConfig);
    }
  };

  const run = async () => {
    try {
      const result = await syncWithRepair();

      if (result.sent > 0 || command === "once") {
        console.log(
          `Scan complete: ${result.files} file(s), ${result.discovered} outbound, ${result.sent} synced, ${result.skipped} skipped.`,
        );
      }
    } catch (error) {
      console.error(`Guildweaver Bridge: ${error.message}`);

      if (command === "once") {
        process.exitCode = 1;
      }
    }
  };

  await run();

  if (command === "once") {
    return;
  }

  console.log(`Watching Guildweaver SavedVariables every ${config.pollIntervalMs}ms.`);

  await new Promise((resolve) => {
    let stopping = false;
    let bridgeUpdatePromise = null;
    let wowWasRunning = isWowRunning();
    let bridgeUpdateTimer = null;
    let wowProcessTimer = null;

    const syncTimer = setInterval(run, config.pollIntervalMs);
    const addonUpdateTimer = setInterval(updateAddon, config.addonUpdateIntervalMs);

    const clearWatchTimers = () => {
      clearInterval(syncTimer);
      clearInterval(addonUpdateTimer);
      if (bridgeUpdateTimer) clearInterval(bridgeUpdateTimer);
      if (wowProcessTimer) clearInterval(wowProcessTimer);
    };

    const checkBridgeAndRestart = () => {
      if (stopping) return Promise.resolve(false);
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
      }
    }, WOW_PROCESS_POLL_INTERVAL_MS);

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

main().catch((error) => {
  console.error(`Guildweaver Bridge: ${error.message}`);
  process.exitCode = 1;
});

#!/usr/bin/env node

import process from "node:process";

import { ensureAddonCurrent } from "./addonManager.js";
import {
  backgroundStatus,
  installBackground,
  uninstallBackground,
} from "./background.js";
import { loadConfig } from "./config.js";
import { acquireInstanceLock } from "./instanceLock.js";
import { enableFileLogging } from "./logger.js";
import { clearCredentials, ensurePaired } from "./pairing.js";
import { syncOnce } from "./sync.js";

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
  pair                 Connect this PC to Holdfast and exit.
  install-background   Start Guildweaver silently at Windows login.
  uninstall-background Stop it and remove Windows startup registration.
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

  if (backgroundMode) {
    enableFileLogging(config.logPath);
  }

  if (command === "uninstall-background") {
    uninstallBackground(config);
    console.log("Guildweaver background bridge removed.");
    return;
  }

  if (command === "background-status") {
    const status = backgroundStatus(config);
    console.log(
      `Guildweaver background bridge: ${status.installed ? "installed" : "not installed"}, ${status.running ? `running (PID ${status.pid})` : "not running"}.`,
    );
    console.log(`Log: ${status.logPath}`);
    return;
  }

  if (command === "install-background") {
    const credentials = await ensurePaired(config);
    const installed = installBackground(config);
    console.log(`Guildweaver is connected as Holdfast member ${credentials.memberId || "unknown"}.`);
    console.log("Background sync installed and started. It will launch automatically when you sign into Windows.");
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

  let updateInFlight = false;
  const updateAddon = async () => {
    if (updateInFlight) return;
    updateInFlight = true;

    try {
      const result = await ensureAddonCurrent(config);
      const message = describeAddonUpdate(result);
      if (message) console.log(message);
    } catch (error) {
      console.error(`Guildweaver addon update: ${error.message}`);
    } finally {
      updateInFlight = false;
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

  const syncTimer = setInterval(run, config.pollIntervalMs);
  const updateTimer = setInterval(updateAddon, config.addonUpdateIntervalMs);

  await new Promise((resolve) => {
    const stop = () => {
      clearInterval(syncTimer);
      clearInterval(updateTimer);
      releaseInstanceLock?.();
      resolve();
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

main().catch((error) => {
  console.error(`Guildweaver Bridge: ${error.message}`);
  process.exitCode = 1;
});

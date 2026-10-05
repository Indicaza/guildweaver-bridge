#!/usr/bin/env node

import process from "node:process";

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
  once                 Pair if needed, then sync unsent Guildweaver revisions.
  watch                Pair if needed, then keep watching SavedVariables.
  pair                 Connect this PC to Holdfast and exit.
  install-background   Start Guildweaver silently at Windows login.
  uninstall-background Stop it and remove Windows startup registration.
  background-status    Show whether the background bridge is installed/running.

A config file is optional. Standard WoW installs and Holdfast production are discovered automatically.
`);
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

  const timer = setInterval(run, config.pollIntervalMs);

  await new Promise((resolve) => {
    const stop = () => {
      clearInterval(timer);
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

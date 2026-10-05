#!/usr/bin/env node

import process from "node:process";

import { loadConfig } from "./config.js";
import { ensurePaired } from "./pairing.js";
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

Commands:
  once   Pair if needed, then sync unsent Guildweaver character revisions.
  watch  Pair if needed, then keep watching for newly flushed SavedVariables.
  pair   Connect this PC to Holdfast and exit.

A config file is optional. Standard WoW installs and Holdfast production are discovered automatically.
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "watch";

  if (command === "help" || args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }

  if (!new Set(["once", "watch", "pair"]).has(command)) {
    usage();
    process.exitCode = 1;
    return;
  }

  const configPath = optionValue(args, "--config") || "guildweaver-bridge.json";
  const config = loadConfig(configPath);
  const credentials = await ensurePaired(config);
  const runtimeConfig = {
    ...config,
    deviceToken: credentials.deviceToken,
  };

  if (command === "pair") {
    console.log(`Connected as Holdfast member ${credentials.memberId || "unknown"}.`);
    return;
  }

  const run = async () => {
    try {
      const result = await syncOnce(runtimeConfig);

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

  console.log(`Watching Guildweaver SavedVariables every ${config.pollIntervalMs}ms. Press Ctrl+C to stop.`);

  const timer = setInterval(run, config.pollIntervalMs);

  await new Promise((resolve) => {
    const stop = () => {
      clearInterval(timer);
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

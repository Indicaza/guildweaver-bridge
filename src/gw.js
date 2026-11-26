#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { readCredentials, openBrowser } from "./pairing.js";
import { lockedInstanceStatus } from "./instanceLock.js";
import { packagedRuntime } from "./packageUpdater.js";
import { runArchiveCommand } from "./archive.js";
import { COMMANDS } from "./cli/registry.js";
import { heading, rows, gold, muted, green, warn, red } from "./cli/output.js";
import { showLogs } from "./cli/logs.js";
import { installCli } from "./cli/install.js";

function parseArgs(args) {
  const rest = [...args];
  const configIndex = rest.indexOf("--config");
  const configPath = configIndex >= 0 ? rest.splice(configIndex, 2)[1] : undefined;
  if (configIndex >= 0 && !configPath) throw new Error("--config needs a path");
  const json = rest.includes("--json");
  return { args: rest.filter((part) => part !== "--json"), configPath, json };
}
function legacy(command, configPath) {
  const args = [fileURLToPath(new URL("./cli.js", import.meta.url)), command];
  if (configPath) args.push("--config", configPath);
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
async function main() {
  const { args, configPath, json } = parseArgs(process.argv.slice(2));
  const [command = "status", ...rest] = args;
  const config = loadConfig(configPath);
  if (command === "help" || command === "--help" || command === "-h") {
    heading("Command center");
    rows(COMMANDS.map(([key, value]) => ["gw " + key, value]));
    return;
  }
  if (command === "status" || command === "version") {
    const credentials = readCredentials(config.credentialsPath);
    const status = lockedInstanceStatus(config.lockPath);
    const release = packagedRuntime()?.release;
    const data = { bridge: status.running ? "running" : "stopped", paired: Boolean(credentials),
      device: credentials?.deviceName || null, channel: config.bridgeUpdateChannel,
      version: release?.releaseVersion || "source checkout", logAvailable: fs.existsSync(config.logPath) };
    if (json) console.log(JSON.stringify(data, null, 2));
    else {
      heading("Command center");
      rows([["Bridge", status.running ? green("Running") : warn("Stopped")], ["Device", data.device || (data.paired ? "Paired" : "Not paired")], ["Channel", data.channel], ["Version", data.version]]);
      console.log("\n" + muted("gw help · gw logs · gw archive status"));
    }
    return;
  }
  if (command === "archive") {
    if (rest.length === 0) {
      heading("Archive");
      rows([["gw archive status", "Check device authorization and markets"], ["gw archive pull", "Export an explicit dataset and destination"]]);
      return;
    }
    await runArchiveCommand(config, rest);
    return;
  }
  if (command === "logs" || (command === "dev" && rest[0] === "logs")) {
    const dev = command === "dev";
    const options = dev ? rest.slice(1) : rest;
    let domain, level, count = 50, follow = dev;
    for (let i = 0; i < options.length; i++) {
      const arg = options[i];
      if (arg === "-f" || arg === "--follow") follow = true;
      else if (arg === "--no-follow") follow = false;
      else if (arg === "--level") level = options[++i];
      else if (arg === "--lines") count = Number(options[++i]);
      else if (arg === "errors") level = "error";
      else if (!arg.startsWith("-") && !domain) domain = arg;
      else throw new Error("Unknown log option: " + arg);
    }
    if (!json) heading(dev ? "Developer logs" : "Activity");
    await showLogs(config, { domain, level, count, follow, json });
    return;
  }
  if (command === "install-cli") {
    console.log("CLI installed in " + installCli(config) + ". Add this directory to PATH if needed.");
    return;
  }
  if (command === "open") { openBrowser(config.holdfastUrl); return; }
  if (command === "pair" && !rest.length) { legacy("pair", configPath); return; }
  throw new Error("Unknown or unavailable command: " + [command, ...rest].join(" ") + ". Run gw help.");
}
main().catch((error) => { console.error(red("✖ " + error.message)); process.exitCode = 1; });

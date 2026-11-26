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
import { heading, rows, gold, muted, green, warn, red, loading } from "./cli/output.js";
import { showLogs, debugEnabled, setDebug } from "./cli/logs.js";
import { installCli } from "./cli/install.js";
import { requestAgent } from "./agent.js";
import { normalizeDomains } from "./domains.js";
import { diagnose } from "./doctor.js";
import { createArchiveProgress } from "./cli/archiveProgress.js";
import { createUpdateProgress } from "./cli/updateProgress.js";
import { completeBridgeUpdate } from "./cli/completeUpdate.js";
import path from "node:path";
import { notify, notificationsEnabled, setNotifications } from "./notifications.js";

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
  if (command === "doctor" || (command === "dev" && rest[0] === "report")) {
    const report = await loading("Checking Guildweaver…", () => diagnose(config), { json });
    if (json || command === "dev") console.log(JSON.stringify(report, null, 2));
    else {
      heading("System diagnostics");
      rows(report.checks.map((check) => [check.name, (check.status === "pass" ? green("✓") : check.status === "fail" ? red("✖") : check.status === "warn" ? warn("!") : muted("·")) + " " + check.detail]));
      console.log(muted("gw doctor --json produces a shareable diagnostic report without credentials, character names or file paths."));
    }
    if (report.checks.some((check) => check.status === "fail")) process.exitCode = 1;
    return;
  }
  if (command === "sync") {
    normalizeDomains(rest);
    const result = await loading("Synchronizing saved game data…", () => requestAgent(config, "sync", rest), { json });
    if (json) console.log(JSON.stringify(result));
    else {
      heading("Synchronization · " + (rest.join(", ") || "all"));
      rows([["Files", String(result.files)], ["Uploaded", green(String(result.telemetrySent))], ["Skipped", String(result.telemetrySkipped)], ["Deferred", warn(String(result.telemetryDeferred))], ["Failed", result.telemetryFailed ? red(String(result.telemetryFailed)) : "0"], ["Rejected", String(result.telemetryRejected)], ["Unreadable files", String(result.unreadableFiles ?? result.skippedFiles)], ["Validation blocked", String(result.blockedFiles ?? 0)], ["Wishlist", result.lootSync], ["Quest inbox", result.questSyncFailed ? "Failed" : result.questSnapshotUpdated ? "Updated" : "Unchanged"]]);
      if (result.blockedFiles) console.log(warn("Save is readable but live validation failed. Open WoW and /reload when ready; no blocked telemetry was uploaded."));
      else console.log(muted("WoW must save data with /reload or logout before it can be uploaded."));
    }
    if (!json && result.retryAfterSeconds) console.log(warn("Website busy · retry in " + result.retryAfterSeconds + "s · unsent data remains queued."));
    if (result.telemetryFailed || result.questSyncFailed || result.skippedFiles || result.lootSync === "failed" || result.retryAfterSeconds) process.exitCode = 1;
    return;
  }
  if (command === "update") {
    if (rest.length > 1 || (rest.length && !["addon", "bridge", "all"].includes(rest[0]))) throw new Error("Use gw update [addon|bridge|all]");
    const target = rest[0] || "all";
    const renderer = createUpdateProgress(target, { json });
    renderer.start();
    try {
      const relative = path.relative(config.installDirectory, process.execPath);
      if (process.platform === "win32" && target !== "addon" && relative && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative)) {
        throw new Error("Run gw from the refreshed launcher so the Windows bridge package can be replaced safely.");
      }
      const previousPid = lockedInstanceStatus(config.lockPath).pid;
      const result = await requestAgent(config, "update", [target], { onProgress: json ? undefined : renderer.show });
      await completeBridgeUpdate(config, result, { previousPid, progress: renderer.show });
      if (json) console.log(JSON.stringify(result));
      else renderer.finish(result);
      if (Object.values(result).some(value => !["current", "package-current", "developer-current", "updated", "developer-updated"].includes(value?.status))) process.exitCode = 1;
    } catch (error) {
      renderer.fail();
      throw error;
    }
    return;
  }
  if (command === "notify") {
    if (rest.length > 1) throw new Error("Use gw notify [on|off|test]");
    if (!rest.length) console.log(notificationsEnabled(config) ? "Notifications enabled" : "Notifications disabled");
    else if (rest[0] === "on" || rest[0] === "off") { setNotifications(config, rest[0] === "on"); console.log("Notifications " + (rest[0] === "on" ? "enabled" : "disabled")); }
    else if (rest[0] === "test") { const result = await notify(config, "Guildweaver", "Desktop notification test", { test: true }); console.log("Notification: " + result.status); if (result.status !== "requested") process.exitCode = 1; }
    else throw new Error("Use gw notify [on|off|test]");
    return;
  }
  if (command === "archive") {
    if (rest.length === 0) {
      heading("Archive");
      rows([["gw archive status", "Check device authorization and markets"], ["gw archive pull", "Export verified pages into an explicit file or directory"], ["gw archive verify", "Validate a local archive directory"], ["gw archive pull-all", "Transfer all market history under an archive hold"], ["gw archive verify-all", "Verify a complete local market transfer"]]);
      return;
    }
    const renderer = createArchiveProgress({ json });
    const controller = new AbortController();
    const interrupt = () => controller.abort(new Error("Archive interrupted; verified pages are preserved"));
    process.once("SIGINT", interrupt);
    try {
      const report = await runArchiveCommand(config, rest, { progress: renderer.show, signal: controller.signal });
      if (report?.complete === false) process.exitCode = 1;
    } finally {
      renderer.finish();
      process.removeListener("SIGINT", interrupt);
    }
    return;
  }
  if (command === "dev" && ["on", "off", "status"].includes(rest[0]) && rest.length === 1) {
    if (rest[0] !== "status") setDebug(config, rest[0] === "on");
    console.log("Debug tracing " + (debugEnabled(config) ? "enabled" : "disabled"));
    return;
  }
  if (command === "dev" && rest[0] === "trace" && rest.length === 2) {
    await showLogs(config, { traceId: rest[1], count: 1000, json });
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
    const directory = installCli(config);
    console.log(process.platform === "win32" ? "CLI registered in your user PATH. Open a new terminal to use gw." : "CLI installed in " + directory + ". Add this directory to PATH if needed.");
    return;
  }
  if (command === "open") { openBrowser(config.holdfastUrl); return; }
  if (command === "pair" && !rest.length) { legacy("pair", configPath); return; }
  throw new Error("Unknown or unavailable command: " + [command, ...rest].join(" ") + ". Run gw help.");
}
main().catch((error) => { console.error(red("✖ " + error.message)); process.exitCode = 1; });

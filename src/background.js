import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  lockedInstanceStatus,
  stopLockedInstance,
} from "./instanceLock.js";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "Guildweaver Bridge";

function quoteCommandArgument(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function vbsString(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function backgroundLauncherSource({
  nodePath,
  cliPath,
  configPath = null,
}) {
  let command = `${quoteCommandArgument(nodePath)} ${quoteCommandArgument(cliPath)} watch --background`;

  if (configPath) {
    command += ` --config ${quoteCommandArgument(configPath)}`;
  }

  return [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run ${vbsString(command)}, 0, False`,
    "",
  ].join("\r\n");
}

export function restartLauncherSource(backgroundLauncherPath, restartPath) {
  return [
    "WScript.Sleep 1500",
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run ${vbsString(`wscript.exe ${quoteCommandArgument(backgroundLauncherPath)}`)}, 0, False`,
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    `If fso.FileExists(${vbsString(restartPath)}) Then fso.DeleteFile ${vbsString(restartPath)}, True`,
    "",
  ].join("\r\n");
}

export function packageReplacementLauncherSource({
  pid,
  installDirectory,
  nextPath,
  backgroundLauncherPath,
  scriptPath,
}) {
  const backupPath = `${installDirectory}.backup`;

  return [
    'Set shell = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'Set wmi = GetObject("winmgmts:\\\\.\\root\\cimv2")',
    "Do",
    `  Set processes = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE ProcessId = ${Number(pid)}")`,
    "  If processes.Count = 0 Then Exit Do",
    "  WScript.Sleep 250",
    "Loop",
    `If fso.FolderExists(${vbsString(backupPath)}) Then fso.DeleteFolder ${vbsString(backupPath)}, True`,
    `If fso.FolderExists(${vbsString(installDirectory)}) Then fso.MoveFolder ${vbsString(installDirectory)}, ${vbsString(backupPath)}`,
    `fso.MoveFolder ${vbsString(nextPath)}, ${vbsString(installDirectory)}`,
    `shell.Run ${vbsString(`wscript.exe ${quoteCommandArgument(backgroundLauncherPath)}`)}, 0, False`,
    "WScript.Sleep 1500",
    `If fso.FolderExists(${vbsString(backupPath)}) Then fso.DeleteFolder ${vbsString(backupPath)}, True`,
    `If fso.FileExists(${vbsString(scriptPath)}) Then fso.DeleteFile ${vbsString(scriptPath)}, True`,
    "",
  ].join("\r\n");
}

function cliPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.js");
}

function requireWindows() {
  if (process.platform !== "win32") {
    throw new Error("Background installation is currently supported on Windows only");
  }
}

function runRegistry(args, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl("reg.exe", args, {
    windowsHide: true,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      String(result.stderr || result.stdout || "Windows startup registration failed").trim(),
    );
  }
}

export function installBackground(config, {
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
} = {}) {
  requireWindows();
  fs.mkdirSync(path.dirname(config.backgroundLauncherPath), { recursive: true });

  const source = backgroundLauncherSource({
    nodePath: process.execPath,
    cliPath: cliPath(),
    configPath: config.configPath,
  });
  fs.writeFileSync(config.backgroundLauncherPath, source, "utf8");

  const startupCommand = `wscript.exe ${quoteCommandArgument(config.backgroundLauncherPath)}`;
  runRegistry(
    [
      "ADD",
      RUN_KEY,
      "/v",
      RUN_VALUE,
      "/t",
      "REG_SZ",
      "/d",
      startupCommand,
      "/f",
    ],
    spawnSyncImpl,
  );

  const child = spawnImpl("wscript.exe", [config.backgroundLauncherPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref?.();

  return {
    launcherPath: config.backgroundLauncherPath,
    logPath: config.logPath,
  };
}

export function scheduleBackgroundRestart(config, { spawnImpl = spawn } = {}) {
  requireWindows();

  if (!fs.existsSync(config.backgroundLauncherPath)) {
    throw new Error("Guildweaver background launcher is not installed");
  }

  const restartPath = path.join(config.dataDirectory, "restart.vbs");
  fs.mkdirSync(config.dataDirectory, { recursive: true });
  fs.writeFileSync(
    restartPath,
    restartLauncherSource(config.backgroundLauncherPath, restartPath),
    "utf8",
  );

  const child = spawnImpl("wscript.exe", [restartPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref?.();

  return { restartPath };
}

export function schedulePackageReplacement(
  config,
  nextPath,
  { spawnImpl = spawn, pid = process.pid } = {},
) {
  requireWindows();

  if (!fs.existsSync(config.backgroundLauncherPath)) {
    throw new Error("Guildweaver background launcher is not installed");
  }

  if (!fs.existsSync(nextPath)) {
    throw new Error("Staged Guildweaver Bridge update is missing");
  }

  const scriptPath = path.join(config.dataDirectory, "replace-bridge.vbs");
  fs.mkdirSync(config.dataDirectory, { recursive: true });
  fs.writeFileSync(
    scriptPath,
    packageReplacementLauncherSource({
      pid,
      installDirectory: config.installDirectory,
      nextPath,
      backgroundLauncherPath: config.backgroundLauncherPath,
      scriptPath,
    }),
    "utf8",
  );

  const child = spawnImpl("wscript.exe", [scriptPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref?.();

  return { scriptPath };
}

export function uninstallBackground(config, { spawnSyncImpl = spawnSync } = {}) {
  requireWindows();

  const result = spawnSyncImpl(
    "reg.exe",
    ["DELETE", RUN_KEY, "/v", RUN_VALUE, "/f"],
    { windowsHide: true, encoding: "utf8" },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const output = String(result.stderr || result.stdout || "");
    if (!/unable to find|not found/i.test(output)) {
      throw new Error(output.trim() || "Unable to remove Guildweaver startup entry");
    }
  }

  stopLockedInstance(config.lockPath);
  fs.rmSync(config.backgroundLauncherPath, { force: true });
}

export function backgroundStatus(config) {
  return {
    installed: fs.existsSync(config.backgroundLauncherPath),
    launcherPath: config.backgroundLauncherPath,
    logPath: config.logPath,
    ...lockedInstanceStatus(config.lockPath),
  };
}

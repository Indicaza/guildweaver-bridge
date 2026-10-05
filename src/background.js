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
const MAC_LABEL = "com.guildweaver.bridge";

function quoteCommandArgument(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function vbsString(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function macDomain() {
  if (process.platform !== "darwin" || typeof process.getuid !== "function") {
    throw new Error("macOS launch domain is unavailable");
  }
  return `gui/${process.getuid()}`;
}

function macServiceTarget() {
  return `${macDomain()}/${MAC_LABEL}`;
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

export function macBackgroundLauncherSource({
  nodePath,
  cliPath,
  configPath = null,
}) {
  const args = [
    shellQuote(nodePath),
    shellQuote(cliPath),
    "watch",
    "--background",
  ];
  if (configPath) args.push("--config", shellQuote(configPath));
  return `#!/bin/sh\nexec ${args.join(" ")}\n`;
}

export function launchAgentPlistSource({ launcherPath, logPath }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>${xmlEscape(launcherPath)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>
</dict>
</plist>
`;
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

export function macRestartLauncherSource({ serviceTarget, scriptPath }) {
  return `#!/bin/sh
sleep 2
launchctl kickstart -k ${shellQuote(serviceTarget)} >/dev/null 2>&1 || true
rm -f ${shellQuote(scriptPath)}
`;
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

export function macPackageReplacementLauncherSource({
  pid,
  installDirectory,
  nextPath,
  serviceTarget,
  scriptPath,
}) {
  const backupPath = `${installDirectory}.backup`;
  return `#!/bin/sh
set -u
while kill -0 ${Number(pid)} 2>/dev/null; do sleep 0.25; done
rm -rf ${shellQuote(backupPath)}
if [ -d ${shellQuote(installDirectory)} ]; then mv ${shellQuote(installDirectory)} ${shellQuote(backupPath)}; fi
if ! mv ${shellQuote(nextPath)} ${shellQuote(installDirectory)}; then
  if [ -d ${shellQuote(backupPath)} ]; then mv ${shellQuote(backupPath)} ${shellQuote(installDirectory)}; fi
  exit 1
fi
launchctl kickstart -k ${shellQuote(serviceTarget)} >/dev/null 2>&1 || true
sleep 2
rm -rf ${shellQuote(backupPath)}
rm -f ${shellQuote(scriptPath)}
`;
}

function cliPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.js");
}

function requireSupportedBackgroundPlatform() {
  if (process.platform !== "win32" && process.platform !== "darwin") {
    throw new Error("Background installation is supported on Windows and macOS only");
  }
}

function runRegistry(args, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl("reg.exe", args, {
    windowsHide: true,
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      String(result.stderr || result.stdout || "Windows startup registration failed").trim(),
    );
  }
}

function runLaunchctl(args, spawnSyncImpl = spawnSync, { allowFailure = false } = {}) {
  const result = spawnSyncImpl("launchctl", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      String(result.stderr || result.stdout || "macOS LaunchAgent registration failed").trim(),
    );
  }
  return result;
}

function installWindowsBackground(config, { spawnImpl, spawnSyncImpl }) {
  fs.mkdirSync(path.dirname(config.backgroundLauncherPath), { recursive: true });
  fs.writeFileSync(
    config.backgroundLauncherPath,
    backgroundLauncherSource({
      nodePath: process.execPath,
      cliPath: cliPath(),
      configPath: config.configPath,
    }),
    "utf8",
  );

  const startupCommand = `wscript.exe ${quoteCommandArgument(config.backgroundLauncherPath)}`;
  runRegistry(
    ["ADD", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", startupCommand, "/f"],
    spawnSyncImpl,
  );

  const child = spawnImpl("wscript.exe", [config.backgroundLauncherPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref?.();
}

function installMacBackground(config, { spawnSyncImpl }) {
  if (!config.launchAgentPath) {
    throw new Error("macOS LaunchAgent path is not configured");
  }

  fs.mkdirSync(path.dirname(config.backgroundLauncherPath), { recursive: true });
  fs.mkdirSync(path.dirname(config.launchAgentPath), { recursive: true });
  fs.writeFileSync(
    config.backgroundLauncherPath,
    macBackgroundLauncherSource({
      nodePath: process.execPath,
      cliPath: cliPath(),
      configPath: config.configPath,
    }),
    { encoding: "utf8", mode: 0o755 },
  );
  fs.chmodSync(config.backgroundLauncherPath, 0o755);
  fs.writeFileSync(
    config.launchAgentPath,
    launchAgentPlistSource({
      launcherPath: config.backgroundLauncherPath,
      logPath: config.logPath,
    }),
    "utf8",
  );

  runLaunchctl(["bootout", macServiceTarget()], spawnSyncImpl, { allowFailure: true });
  runLaunchctl(["bootstrap", macDomain(), config.launchAgentPath], spawnSyncImpl);
  runLaunchctl(["kickstart", "-k", macServiceTarget()], spawnSyncImpl);
}

export function installBackground(
  config,
  { spawnImpl = spawn, spawnSyncImpl = spawnSync } = {},
) {
  requireSupportedBackgroundPlatform();

  if (process.platform === "win32") {
    installWindowsBackground(config, { spawnImpl, spawnSyncImpl });
  } else {
    installMacBackground(config, { spawnSyncImpl });
  }

  return {
    launcherPath:
      process.platform === "darwin" ? config.launchAgentPath : config.backgroundLauncherPath,
    logPath: config.logPath,
  };
}

export function scheduleBackgroundRestart(config, { spawnImpl = spawn } = {}) {
  requireSupportedBackgroundPlatform();

  if (process.platform === "win32") {
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

  if (!config.launchAgentPath || !fs.existsSync(config.launchAgentPath)) {
    throw new Error("Guildweaver LaunchAgent is not installed");
  }
  const restartPath = path.join(config.dataDirectory, "restart.sh");
  fs.writeFileSync(
    restartPath,
    macRestartLauncherSource({
      serviceTarget: macServiceTarget(),
      scriptPath: restartPath,
    }),
    { encoding: "utf8", mode: 0o755 },
  );
  fs.chmodSync(restartPath, 0o755);
  const child = spawnImpl("/bin/sh", [restartPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref?.();
  return { restartPath };
}

export function schedulePackageReplacement(
  config,
  nextPath,
  { spawnImpl = spawn, pid = process.pid } = {},
) {
  requireSupportedBackgroundPlatform();

  if (!fs.existsSync(nextPath)) {
    throw new Error("Staged Guildweaver Bridge update is missing");
  }

  fs.mkdirSync(config.dataDirectory, { recursive: true });

  if (process.platform === "win32") {
    if (!fs.existsSync(config.backgroundLauncherPath)) {
      throw new Error("Guildweaver background launcher is not installed");
    }
    const scriptPath = path.join(config.dataDirectory, "replace-bridge.vbs");
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

  if (!config.launchAgentPath || !fs.existsSync(config.launchAgentPath)) {
    throw new Error("Guildweaver LaunchAgent is not installed");
  }
  const scriptPath = path.join(config.dataDirectory, "replace-bridge.sh");
  fs.writeFileSync(
    scriptPath,
    macPackageReplacementLauncherSource({
      pid,
      installDirectory: config.installDirectory,
      nextPath,
      serviceTarget: macServiceTarget(),
      scriptPath,
    }),
    { encoding: "utf8", mode: 0o755 },
  );
  fs.chmodSync(scriptPath, 0o755);
  const child = spawnImpl("/bin/sh", [scriptPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref?.();
  return { scriptPath };
}

export function uninstallBackground(config, { spawnSyncImpl = spawnSync } = {}) {
  requireSupportedBackgroundPlatform();

  if (process.platform === "win32") {
    const result = spawnSyncImpl(
      "reg.exe",
      ["DELETE", RUN_KEY, "/v", RUN_VALUE, "/f"],
      { windowsHide: true, encoding: "utf8" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const output = String(result.stderr || result.stdout || "");
      if (!/unable to find|not found/i.test(output)) {
        throw new Error(output.trim() || "Unable to remove Guildweaver startup entry");
      }
    }
    fs.rmSync(config.backgroundLauncherPath, { force: true });
  } else {
    runLaunchctl(["bootout", macServiceTarget()], spawnSyncImpl, { allowFailure: true });
    if (config.launchAgentPath) fs.rmSync(config.launchAgentPath, { force: true });
    fs.rmSync(config.backgroundLauncherPath, { force: true });
  }

  stopLockedInstance(config.lockPath);
}

export function backgroundStatus(config) {
  const registrationPath =
    process.platform === "darwin" ? config.launchAgentPath : config.backgroundLauncherPath;
  return {
    installed: Boolean(registrationPath && fs.existsSync(registrationPath)),
    launcherPath: registrationPath,
    logPath: config.logPath,
    ...lockedInstanceStatus(config.lockPath),
  };
}

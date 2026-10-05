import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  lockedInstanceStatus,
  stopLockedInstance,
} from "./instanceLock.js";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function desktopExecQuote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function cliPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.js");
}

function requireLinux() {
  if (process.platform !== "linux") {
    throw new Error("Linux background integration is only available on Linux");
  }
}

export function linuxAutostartPath({
  env = process.env,
  homeDirectory = os.homedir(),
} = {}) {
  const configRoot = env.XDG_CONFIG_HOME || path.join(homeDirectory, ".config");
  return path.join(configRoot, "autostart", "guildweaver-bridge.desktop");
}

export function linuxBackgroundLauncherSource({
  nodePath,
  cliPath: bridgeCliPath,
  configPath = null,
}) {
  const args = [
    shellQuote(nodePath),
    shellQuote(bridgeCliPath),
    "watch",
    "--background",
  ];
  if (configPath) args.push("--config", shellQuote(configPath));
  return `#!/bin/sh\nexec ${args.join(" ")}\n`;
}

export function linuxAutostartDesktopSource({ launcherPath }) {
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=Guildweaver Bridge
Comment=Sync Guildweaver with Holdfast
Exec=/bin/sh ${desktopExecQuote(launcherPath)}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
}

export function linuxRestartLauncherSource({
  backgroundLauncherPath,
  scriptPath,
}) {
  return `#!/bin/sh
set -u
sleep 2
(/bin/sh ${shellQuote(backgroundLauncherPath)} >/dev/null 2>&1) &
rm -f ${shellQuote(scriptPath)}
`;
}

export function linuxPackageReplacementLauncherSource({
  pid,
  installDirectory,
  nextPath,
  backgroundLauncherPath,
  lockPath,
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
  (/bin/sh ${shellQuote(backgroundLauncherPath)} >/dev/null 2>&1) &
  exit 1
fi
(/bin/sh ${shellQuote(backgroundLauncherPath)} >/dev/null 2>&1) &
started=0
i=0
while [ "$i" -lt 20 ]; do
  if [ -f ${shellQuote(lockPath)} ]; then started=1; break; fi
  i=$((i + 1))
  sleep 0.25
done
if [ "$started" -ne 1 ]; then
  rm -rf ${shellQuote(installDirectory)}
  if [ -d ${shellQuote(backupPath)} ]; then mv ${shellQuote(backupPath)} ${shellQuote(installDirectory)}; fi
  (/bin/sh ${shellQuote(backgroundLauncherPath)} >/dev/null 2>&1) &
  exit 1
fi
rm -rf ${shellQuote(backupPath)}
rm -f ${shellQuote(scriptPath)}
`;
}

export function installBackground(config, { spawnImpl = spawn } = {}) {
  requireLinux();

  const autostartPath = linuxAutostartPath();
  fs.mkdirSync(path.dirname(config.backgroundLauncherPath), { recursive: true });
  fs.mkdirSync(path.dirname(autostartPath), { recursive: true });
  fs.writeFileSync(
    config.backgroundLauncherPath,
    linuxBackgroundLauncherSource({
      nodePath: process.execPath,
      cliPath: cliPath(),
      configPath: config.configPath,
    }),
    { encoding: "utf8", mode: 0o755 },
  );
  fs.chmodSync(config.backgroundLauncherPath, 0o755);
  fs.writeFileSync(
    autostartPath,
    linuxAutostartDesktopSource({ launcherPath: config.backgroundLauncherPath }),
    "utf8",
  );

  const child = spawnImpl("/bin/sh", [config.backgroundLauncherPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref?.();

  return {
    launcherPath: autostartPath,
    logPath: config.logPath,
  };
}

export function scheduleBackgroundRestart(config, { spawnImpl = spawn } = {}) {
  requireLinux();

  if (!fs.existsSync(config.backgroundLauncherPath)) {
    throw new Error("Guildweaver background launcher is not installed");
  }

  const restartPath = path.join(config.dataDirectory, "restart.sh");
  fs.mkdirSync(config.dataDirectory, { recursive: true });
  fs.writeFileSync(
    restartPath,
    linuxRestartLauncherSource({
      backgroundLauncherPath: config.backgroundLauncherPath,
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
  requireLinux();

  if (!fs.existsSync(nextPath)) {
    throw new Error("Staged Guildweaver Bridge update is missing");
  }
  if (!fs.existsSync(config.backgroundLauncherPath)) {
    throw new Error("Guildweaver background launcher is not installed");
  }

  const scriptPath = path.join(config.dataDirectory, "replace-bridge.sh");
  fs.mkdirSync(config.dataDirectory, { recursive: true });
  fs.writeFileSync(
    scriptPath,
    linuxPackageReplacementLauncherSource({
      pid,
      installDirectory: config.installDirectory,
      nextPath,
      backgroundLauncherPath: config.backgroundLauncherPath,
      lockPath: config.lockPath,
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

export function uninstallBackground(config) {
  requireLinux();
  fs.rmSync(linuxAutostartPath(), { force: true });
  fs.rmSync(config.backgroundLauncherPath, { force: true });
  stopLockedInstance(config.lockPath);
}

export function backgroundStatus(config) {
  const autostartPath = linuxAutostartPath();
  return {
    installed:
      fs.existsSync(autostartPath) && fs.existsSync(config.backgroundLauncherPath),
    launcherPath: autostartPath,
    logPath: config.logPath,
    ...lockedInstanceStatus(config.lockPath),
  };
}

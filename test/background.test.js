import assert from "node:assert/strict";
import test from "node:test";

import {
  backgroundLauncherSource,
  launchAgentPlistSource,
  macBackgroundLauncherSource,
  macPackageReplacementLauncherSource,
  macRestartLauncherSource,
  packageReplacementLauncherSource,
  restartLauncherSource,
} from "../src/background.js";

test("Windows background launcher starts the bridge hidden with stable absolute paths", () => {
  const source = backgroundLauncherSource({
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    cliPath: "C:\\Users\\Zach\\Projects\\guildweaver bridge\\src\\cli.js",
    configPath: "C:\\Users\\Zach\\guildweaver-bridge.json",
  });

  assert.match(source, /WScript\.Shell/);
  assert.match(source, /watch --background/);
  assert.match(source, /Program Files\\nodejs\\node\.exe/);
  assert.match(source, /guildweaver bridge\\src\\cli\.js/);
  assert.match(source, /guildweaver-bridge\.json/);
  assert.match(source, /, 0, False/);
});

test("macOS background launcher uses absolute quoted paths", () => {
  const source = macBackgroundLauncherSource({
    nodePath: "/Users/Zach/Library/Application Support/Guildweaver/app/node",
    cliPath: "/Users/Zach/Library/Application Support/Guildweaver/app/app/src/cli.js",
    configPath: "/Users/Zach/My Config/guildweaver.json",
  });

  assert.match(source, /^#!\/bin\/sh/);
  assert.match(source, /watch --background/);
  assert.match(source, /Application Support/);
  assert.match(source, /My Config/);
  assert.match(source, /^exec /m);
});

test("macOS LaunchAgent is persistent and points at the stable launcher", () => {
  const source = launchAgentPlistSource({
    launcherPath: "/Users/Zach/Library/Application Support/Guildweaver/background.sh",
    logPath: "/Users/Zach/Library/Application Support/Guildweaver/bridge.log",
  });

  assert.match(source, /com\.guildweaver\.bridge/);
  assert.match(source, /<key>RunAtLoad<\/key>/);
  assert.match(source, /<key>KeepAlive<\/key>/);
  assert.match(source, /background\.sh/);
  assert.match(source, /bridge\.log/);
});

test("Windows restart launcher waits before relaunching", () => {
  const source = restartLauncherSource(
    "C:\\Users\\Zach\\AppData\\Local\\Guildweaver\\background.vbs",
    "C:\\Users\\Zach\\AppData\\Local\\Guildweaver\\restart.vbs",
  );

  assert.match(source, /WScript\.Sleep 1500/);
  assert.match(source, /wscript\.exe/);
  assert.match(source, /background\.vbs/);
  assert.match(source, /DeleteFile/);
  assert.match(source, /restart\.vbs/);
});

test("macOS restart hands control back to launchd", () => {
  const source = macRestartLauncherSource({
    serviceTarget: "gui/501/com.guildweaver.bridge",
    scriptPath: "/tmp/guildweaver restart.sh",
  });

  assert.match(source, /sleep 2/);
  assert.match(source, /launchctl kickstart -k/);
  assert.match(source, /gui\/501\/com\.guildweaver\.bridge/);
  assert.match(source, /rm -f/);
});

test("Windows packaged update waits for the current PID then swaps and relaunches", () => {
  const source = packageReplacementLauncherSource({
    pid: 4242,
    installDirectory: "C:\\Users\\Zach\\AppData\\Local\\Guildweaver\\app",
    nextPath: "C:\\Users\\Zach\\AppData\\Local\\Guildweaver\\app.next",
    backgroundLauncherPath: "C:\\Users\\Zach\\AppData\\Local\\Guildweaver\\background.vbs",
    scriptPath: "C:\\Users\\Zach\\AppData\\Local\\Guildweaver\\replace-bridge.vbs",
  });

  assert.match(source, /ProcessId = 4242/);
  assert.match(source, /app\.backup/);
  assert.match(source, /MoveFolder/);
  assert.match(source, /app\.next/);
  assert.match(source, /background\.vbs/);
  assert.match(source, /replace-bridge\.vbs/);
});

test("macOS packaged update waits for the PID, swaps atomically, and restarts launchd", () => {
  const source = macPackageReplacementLauncherSource({
    pid: 4242,
    installDirectory: "/Users/Zach/Library/Application Support/Guildweaver/app",
    nextPath: "/Users/Zach/Library/Application Support/Guildweaver/app.next",
    serviceTarget: "gui/501/com.guildweaver.bridge",
    scriptPath: "/Users/Zach/Library/Application Support/Guildweaver/replace-bridge.sh",
  });

  assert.match(source, /kill -0 4242/);
  assert.match(source, /app\.backup/);
  assert.match(source, /app\.next/);
  assert.match(source, /launchctl kickstart -k/);
  assert.match(source, /gui\/501\/com\.guildweaver\.bridge/);
  assert.match(source, /mv/);
});

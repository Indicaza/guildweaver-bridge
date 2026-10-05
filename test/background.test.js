import assert from "node:assert/strict";
import test from "node:test";

import {
  backgroundLauncherSource,
  packageReplacementLauncherSource,
  restartLauncherSource,
} from "../src/background.js";

test("background launcher starts the bridge hidden with stable absolute paths", () => {
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

test("restart launcher waits for the old bridge to exit before relaunching", () => {
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

test("packaged update waits for the current PID then swaps and relaunches", () => {
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

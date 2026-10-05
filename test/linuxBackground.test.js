import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  linuxAutostartDesktopSource,
  linuxAutostartPath,
  linuxBackgroundLauncherSource,
  linuxPackageReplacementLauncherSource,
  linuxRestartLauncherSource,
} from "../src/linuxBackground.js";

test("Linux background launcher uses absolute quoted paths", () => {
  const source = linuxBackgroundLauncherSource({
    nodePath: "/home/zach/.local/state/guildweaver/app/node",
    cliPath: "/home/zach/.local/state/guildweaver/app/app/src/cli.js",
    configPath: "/home/zach/My Config/guildweaver.json",
  });

  assert.match(source, /^#!\/bin\/sh/);
  assert.match(source, /watch --background/);
  assert.match(source, /My Config/);
  assert.match(source, /^exec /m);
});

test("Linux autostart follows XDG_CONFIG_HOME", () => {
  assert.equal(
    linuxAutostartPath({
      env: { XDG_CONFIG_HOME: "/tmp/custom config" },
      homeDirectory: "/home/zach",
    }),
    path.join("/tmp/custom config", "autostart", "guildweaver-bridge.desktop"),
  );
});

test("Linux desktop entry launches the stable background script without a terminal", () => {
  const source = linuxAutostartDesktopSource({
    launcherPath: "/home/zach/.local/state/guildweaver/background.sh",
  });

  assert.match(source, /^\[Desktop Entry\]/);
  assert.match(source, /Exec=\/bin\/sh/);
  assert.match(source, /background\.sh/);
  assert.match(source, /Terminal=false/);
  assert.match(source, /X-GNOME-Autostart-enabled=true/);
});

test("Linux restart relaunches the stable background script", () => {
  const source = linuxRestartLauncherSource({
    backgroundLauncherPath: "/home/zach/.local/state/guildweaver/background.sh",
    scriptPath: "/home/zach/.local/state/guildweaver/restart.sh",
  });

  assert.match(source, /sleep 2/);
  assert.match(source, /background\.sh/);
  assert.match(source, /rm -f/);
  assert.match(source, /restart\.sh/);
});

test("Linux packaged update waits, swaps, verifies restart, and keeps rollback", () => {
  const source = linuxPackageReplacementLauncherSource({
    pid: 4242,
    installDirectory: "/home/zach/.local/state/guildweaver/app",
    nextPath: "/home/zach/.local/state/guildweaver/app.next",
    backgroundLauncherPath: "/home/zach/.local/state/guildweaver/background.sh",
    lockPath: "/home/zach/.local/state/guildweaver/bridge.lock",
    scriptPath: "/home/zach/.local/state/guildweaver/replace-bridge.sh",
  });

  assert.match(source, /kill -0 4242/);
  assert.match(source, /app\.backup/);
  assert.match(source, /app\.next/);
  assert.match(source, /bridge\.lock/);
  assert.match(source, /started=0/);
  assert.match(source, /background\.sh/);
});

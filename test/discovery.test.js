import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { findAddonPath, findSavedVariablesFiles, linuxWowDirectories } from "../src/discovery.js";

test("Linux discovery includes Wine and common launcher prefixes", () => {
  const homeDirectory = path.join(path.sep, "home", "zach");
  const winePrefix = path.join(path.sep, "games", "custom-prefix");
  const candidates = linuxWowDirectories({
    homeDirectory,
    env: { WINEPREFIX: winePrefix },
  });

  assert.ok(
    candidates.includes(
      path.join(
        winePrefix,
        "drive_c",
        "Program Files (x86)",
        "World of Warcraft",
      ),
    ),
  );
  assert.ok(
    candidates.includes(
      path.join(
        homeDirectory,
        ".wine",
        "drive_c",
        "Program Files (x86)",
        "World of Warcraft",
      ),
    ),
  );
  assert.ok(candidates.includes(path.join(homeDirectory, "Games", "World of Warcraft")));
});

test("beta overrides follow the sibling live installation and wait when it is absent", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-cutover-"));
  const beta = path.join(directory, "_classic_beta_");
  const live = path.join(directory, "_forever_");
  const addon = path.join("Interface", "AddOns", "Guildweaver");
  const saved = path.join("WTF", "Account", "player", "SavedVariables", "Guildweaver.lua");
  const config = { wowRoot: beta, addonPath: path.join(beta, addon), savedVariablesPath: path.join(beta, saved) };
  try {
    fs.mkdirSync(path.dirname(config.savedVariablesPath), { recursive: true });
    fs.writeFileSync(config.savedVariablesPath, "beta");
    assert.throws(() => findAddonPath(config), /Forever installation not found/);
    assert.throws(() => findSavedVariablesFiles(config), /Forever installation not found/);
    fs.mkdirSync(path.dirname(path.join(live, saved)), { recursive: true });
    fs.writeFileSync(path.join(live, saved), "live");
    assert.equal(findAddonPath(config), path.join(live, addon));
    assert.deepEqual(findSavedVariablesFiles(config), [path.join(live, saved)]);
    assert.deepEqual(findSavedVariablesFiles({ wowRoot: beta }), [path.join(live, saved)]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { linuxWowDirectories } from "../src/discovery.js";

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

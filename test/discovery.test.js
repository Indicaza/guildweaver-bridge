import assert from "node:assert/strict";
import test from "node:test";

import { linuxWowDirectories } from "../src/discovery.js";

test("Linux discovery includes Wine and common launcher prefixes", () => {
  const homeDirectory = "/home/zach";
  const candidates = linuxWowDirectories({
    homeDirectory,
    env: { WINEPREFIX: "/games/custom-prefix" },
  });

  assert.ok(
    candidates.includes(
      "/games/custom-prefix/drive_c/Program Files (x86)/World of Warcraft",
    ),
  );
  assert.ok(
    candidates.includes(
      "/home/zach/.wine/drive_c/Program Files (x86)/World of Warcraft",
    ),
  );
  assert.ok(candidates.includes("/home/zach/Games/World of Warcraft"));
});

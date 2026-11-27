import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installedWindowsRuntime, prepareWindowsCliRuntime } from "../src/cli/install.js";

test("launcher repair selects installed package rather than the stale CLI copy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gw-cli-repair-"));
  try {
    const installDirectory = path.join(root, "installed");
    const app = path.join(installDirectory, "app");
    fs.mkdirSync(path.join(app, "src"), { recursive: true });
    fs.writeFileSync(path.join(installDirectory, "node.exe"), "fixture");
    fs.writeFileSync(path.join(app, "src", "gw.js"), "new-cli");
    const commit = "b".repeat(40);
    fs.writeFileSync(path.join(app, "release.json"), JSON.stringify({ schemaVersion: 1, commit }));
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    const runtime = installedWindowsRuntime({ installDirectory });
    const target = prepareWindowsCliRuntime(bin, runtime);
    assert.match(target.entry, /runtime-b{40}/);
    assert.equal(fs.readFileSync(target.entry, "utf8"), "new-cli");
    fs.rmSync(path.join(app, "src", "gw.js"));
    assert.throws(() => installedWindowsRuntime({ installDirectory }), /incomplete/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packagedRuntime } from "../packageUpdater.js";
import { randomUUID } from "node:crypto";

export function prepareWindowsCliRuntime(directory, runtime) {
  const commit = runtime.release?.commit;
  if (typeof commit !== "string" || !/^[a-f0-9]{40}$/i.test(commit)) throw new Error("CLI package has no valid release commit");
  const target = path.join(directory, "runtime-" + commit);
  const entry = path.join(target, "app", "src", "gw.js");
  const node = path.join(target, "node.exe");
  const valid = () => {
    try {
      return fs.existsSync(node) && fs.existsSync(entry) &&
        JSON.parse(fs.readFileSync(path.join(target, "app", "release.json"), "utf8")).commit === commit;
    } catch { return false; }
  };
  if (!valid()) {
    if (fs.existsSync(target)) throw new Error("Existing CLI runtime is incomplete; reinstall Guildweaver");
    const temporary = target + ".partial-" + randomUUID();
    try {
      fs.mkdirSync(temporary, { recursive: true });
      fs.copyFileSync(runtime.nodePath, path.join(temporary, "node.exe"));
      fs.cpSync(runtime.applicationRoot, path.join(temporary, "app"), { recursive: true });
      try { fs.renameSync(temporary, target); } catch (error) { if (!valid()) throw error; }
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
  if (!valid()) throw new Error("CLI runtime copy failed validation");
  // Retain the current and previous runtime. A running Windows executable
  // can lock its directory; never recursively remove it unless renamed first.
  const older = fs.readdirSync(directory, { withFileTypes: true })
    .filter(item => item.isDirectory() && /^runtime-[a-f0-9]{40}$/i.test(item.name) && item.name !== path.basename(target))
    .map(item => ({ file: path.join(directory, item.name), mtime: fs.statSync(path.join(directory, item.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { file } of older.slice(1)) {
    const obsolete = file + ".obsolete-" + randomUUID();
    try { fs.renameSync(file, obsolete); fs.rmSync(obsolete, { recursive: true, force: true }); } catch {}
  }
  return { node, entry };
}

export function installCli(config) {
  const directory = path.join(config.dataDirectory, "bin");
  fs.mkdirSync(directory, { recursive: true });
  let entry = fileURLToPath(new URL("../gw.js", import.meta.url));
  let node = process.execPath;
  const windows = process.platform === "win32";
  const runtime = windows ? packagedRuntime() : null;
  if (runtime) ({ entry, node } = prepareWindowsCliRuntime(directory, runtime));
  const target = path.join(directory, windows ? "gw.cmd" : "gw");
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const configArgs = config.configPath ? (windows ? ' --config "' + config.configPath.replaceAll("%", "%%") + '"' : " --config " + quote(config.configPath)) : "";
  const source = windows
    ? '@echo off\r\n"' + node.replaceAll("%", "%%") + '" "' + entry.replaceAll("%", "%%") + '" %*' + configArgs + '\r\n'
    : "#!/bin/sh\nexec " + quote(node) + " " + quote(entry) + ' "$@"' + configArgs + "\n";
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== source) fs.writeFileSync(target, source, { mode: 0o755 });
  if (!windows) fs.chmodSync(target, 0o755);
  return directory;
}

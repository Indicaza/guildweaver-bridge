import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function installCli(config) {
  const directory = path.join(config.dataDirectory, "bin");
  fs.mkdirSync(directory, { recursive: true });
  const entry = fileURLToPath(new URL("../gw.js", import.meta.url));
  const windows = process.platform === "win32";
  const target = path.join(directory, windows ? "gw.cmd" : "gw");
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const configArgs = config.configPath ? (windows ? ' --config "' + config.configPath.replaceAll("%", "%%") + '"' : " --config " + quote(config.configPath)) : "";
  const source = windows
    ? '@echo off\r\n"' + process.execPath.replaceAll("%", "%%") + '" "' + entry.replaceAll("%", "%%") + '" %*' + configArgs + '\r\n'
    : "#!/bin/sh\nexec " + quote(process.execPath) + " " + quote(entry) + ' "$@"' + configArgs + "\n";
  fs.writeFileSync(target, source, { mode: 0o755 });
  if (!windows) fs.chmodSync(target, 0o755);
  return directory;
}

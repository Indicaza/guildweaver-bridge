import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { redact } from "./cli/logs.js";

const MAX_LOG_BYTES = 1024 * 1024;

function rotateLog(filePath) {
  try {
    if (fs.statSync(filePath).size < MAX_LOG_BYTES) {
      return;
    }

    const previous = `${filePath}.1`;
    fs.rmSync(previous, { force: true });
    fs.renameSync(filePath, previous);
  } catch {
    return;
  }
}

function formatValue(value) {
  return typeof value === "string"
    ? value
    : util.inspect(value, { depth: 4, breakLength: Infinity });
}

export function enableFileLogging(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  rotateLog(filePath);

  const write = (level, values) => {
    const message = redact(values.map(formatValue).join(" ")).replace(/[\r\n]+/g, " ").slice(0, 4000);
    const line = `[${new Date().toISOString()}] ${level} ${message}\n`;
    try {
      rotateLog(filePath);
      fs.appendFileSync(filePath, line, { encoding: "utf8", mode: 0o600 });
    } catch {
      // Logging must not stop gameplay synchronization.
    }
  };

  console.log = (...values) => write("INFO", values);
  console.error = (...values) => write("ERROR", values);
}

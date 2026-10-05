import fs from "node:fs";
import path from "node:path";
import util from "node:util";

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
    const message = values.map(formatValue).join(" ");
    const line = `[${new Date().toISOString()}] ${level} ${message}\n`;
    fs.appendFileSync(filePath, line, "utf8");
  };

  console.log = (...values) => write("INFO", values);
  console.error = (...values) => write("ERROR", values);
}

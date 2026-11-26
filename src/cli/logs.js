import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { gold, muted, red, warn, green } from "./output.js";

const MAX_READ = 1024 * 1024;
export function logDomain(message) {
  const text = String(message).toLowerCase();
  if (/auction|\bah\b|market/.test(text)) return "ah";
  if (/wishlist|loot inbox|boe/.test(text)) return "wishlist";
  if (/quest/.test(text)) return "quests";
  if (/profession|recipe/.test(text)) return "professions";
  if (/dungeon/.test(text)) return "dungeons";
  if (/gather|farming/.test(text)) return "gathering";
  if (/character|equipment|talent|inventory|stats/.test(text)) return "character";
  if (/http|network|timeout|request/.test(text)) return "network";
  if (/update|release|restart/.test(text)) return "updates";
  if (/sync|telemetry|scan|acknowledg/.test(text)) return "sync";
  return "bridge";
}
export function redact(message) {
  return String(message)
    .replace(/\b(?:gwd|gwp)_[a-z0-9_-]+/gi, "[redacted]")
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(/((?:deviceToken|authorization|token|secret)\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[redacted]");
}
export function parseLog(line) {
  try {
    const value = JSON.parse(line);
    if (typeof value.message === "string" && typeof value.level === "string")
      return { ...value, message: redact(value.message) };
  } catch {}
  const match = line.match(/^\[([^\]]+)\]\s+(INFO|ERROR|WARN|DEBUG|TRACE)\s+(.*)$/);
  if (!match) return { time: "", level: "INFO", domain: logDomain(line), message: redact(line) };
  return { time: match[1], level: match[2], domain: logDomain(match[3]), message: redact(match[3]) };
}
function readRange(file, offset, size) {
  const fd = fs.openSync(file, "r");
  try {
    const bytes = Buffer.alloc(Math.min(size, MAX_READ));
    return bytes.subarray(0, fs.readSync(fd, bytes, 0, bytes.length, offset)).toString("utf8");
  } finally { fs.closeSync(fd); }
}
export async function showLogs(config, { domain, level, follow, json, count = 50 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("--lines must be 1–1000");
  const display = (line) => {
    if (!line) return;
    const event = parseLog(line);
    if (domain && domain !== "all" && domain !== event.domain) return;
    if (level && event.level.toLowerCase() !== level.toLowerCase()) return;
    if (json) console.log(JSON.stringify(event));
    else {
      const style = event.level === "ERROR" ? red : event.level === "WARN" ? warn : green;
      console.log(muted(event.time.slice(11, 19)) + " " + style(event.level.padEnd(5)) + " " + gold(event.domain.toUpperCase().padEnd(12)) + " " + event.message);
    }
  };
  let offset = 0;
  let identity = "";
  if (fs.existsSync(config.logPath)) {
    const stat = fs.statSync(config.logPath);
    identity = stat.ino + ":" + stat.birthtimeMs;
    offset = stat.size;
    const start = Math.max(0, offset - MAX_READ);
    const lines = readRange(config.logPath, start, offset - start).split("\n");
    if (start > 0) lines.shift();
    lines.filter(Boolean).slice(-count).forEach(display);
  } else if (!json) console.log(muted("No bridge log yet."));
  while (follow) {
    await sleep(500);
    try {
      const stat = fs.statSync(config.logPath);
      const nextIdentity = stat.ino + ":" + stat.birthtimeMs;
      if (identity !== nextIdentity || stat.size < offset) offset = 0;
      identity = nextIdentity;
      if (stat.size > offset) {
        const start = Math.max(offset, stat.size - MAX_READ);
        const chunk = readRange(config.logPath, start, stat.size - start);
        const end = chunk.lastIndexOf("\n");
        if (end >= 0) {
          const lines = chunk.slice(0, end).split("\n");
          if (start > offset) lines.shift();
          lines.forEach(display);
          offset = start + Buffer.byteLength(chunk.slice(0, end + 1));
        }
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

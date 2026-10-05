import fs from "node:fs";
import path from "node:path";

import { findAddonPath } from "./discovery.js";

function luaString(value) {
  return `"${String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t")}"`;
}

function luaValue(value, depth = 0) {
  if (value === null || value === undefined) return "nil";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot serialize non-finite Lua number");
    return String(value);
  }
  if (typeof value === "string") return luaString(value);

  const indent = "    ".repeat(depth);
  const childIndent = "    ".repeat(depth + 1);

  if (Array.isArray(value)) {
    if (!value.length) return "{}";
    return `\n${indent}{\n${value
      .map((item) => `${childIndent}${luaValue(item, depth + 1)},`)
      .join("\n")}\n${indent}}`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (!entries.length) return "{}";

    return `\n${indent}{\n${entries
      .map(
        ([key, item]) =>
          `${childIndent}[${luaString(key)}] = ${luaValue(item, depth + 1)},`,
      )
      .join("\n")}\n${indent}}`;
  }

  throw new Error(`Unsupported inbox value type: ${typeof value}`);
}

export function bridgeInboxSource({ quests, acknowledgedQuestActions = [] }) {
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    acknowledgedQuestActions,
    quests,
  };

  return `local _, GW = ...\n\nGW.BridgeInbox = ${luaValue(payload)}\n`;
}

export function writeBridgeInbox(config, payload) {
  const addonPath = findAddonPath(config);
  const inboxPath = path.join(addonPath, "Data", "BridgeInbox.generated.lua");
  const source = bridgeInboxSource(payload);

  fs.mkdirSync(path.dirname(inboxPath), { recursive: true });

  if (fs.existsSync(inboxPath) && fs.readFileSync(inboxPath, "utf8") === source) {
    return { path: inboxPath, changed: false };
  }

  const temporary = `${inboxPath}.tmp`;
  fs.writeFileSync(temporary, source, "utf8");
  fs.rmSync(inboxPath, { force: true });
  fs.renameSync(temporary, inboxPath);

  return { path: inboxPath, changed: true };
}

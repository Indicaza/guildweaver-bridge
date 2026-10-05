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

function inboxMarker(quests, acknowledgedQuestActions) {
  const revision = Number(quests?.revision) || 0;
  const acknowledgements = [...acknowledgedQuestActions].map(String).sort().join(",");
  return `-- Guildweaver Bridge inbox ${revision}:${acknowledgements}`;
}

export function bridgeInboxSource({ quests, acknowledgedQuestActions = [] }) {
  const payload = {
    schemaVersion: 1,
    acknowledgedQuestActions,
    quests,
  };
  const marker = inboxMarker(quests, acknowledgedQuestActions);

  return `${marker}\nlocal _, GW = ...\n\nGW.BridgeInbox = ${luaValue(payload)}\n`;
}

export function writeBridgeInbox(config, payload) {
  const addonPath = findAddonPath(config);
  const inboxPath = path.join(addonPath, "Data", "BridgeInbox.generated.lua");
  const source = bridgeInboxSource(payload);
  const marker = source.split("\n", 1)[0];

  fs.mkdirSync(path.dirname(inboxPath), { recursive: true });

  if (fs.existsSync(inboxPath)) {
    const existing = fs.readFileSync(inboxPath, "utf8");
    if (existing.split("\n", 1)[0] === marker) {
      return { path: inboxPath, changed: false };
    }
  }

  const temporary = `${inboxPath}.tmp`;
  fs.writeFileSync(temporary, source, "utf8");
  fs.rmSync(inboxPath, { force: true });
  fs.renameSync(temporary, inboxPath);

  return { path: inboxPath, changed: true };
}

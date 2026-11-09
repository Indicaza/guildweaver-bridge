import fs from "node:fs";
import path from "node:path";

import { findAddonPath } from "./discovery.js";

const GENERATED_INBOX = "Data/BridgeInbox.generated.lua";
const GENERATED_ACKS = "Data/BridgeAcks.generated.lua";

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

function excludeGeneratedInboxFromCheckout(addonPath, generated = GENERATED_INBOX) {
  if (!fs.existsSync(addonPath)) return;

  const realPath = fs.realpathSync.native(addonPath);
  const gitDirectory = path.join(realPath, ".git");
  if (!fs.existsSync(gitDirectory) || !fs.statSync(gitDirectory).isDirectory()) return;

  const excludePath = path.join(gitDirectory, "info", "exclude");
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const existing = fs.existsSync(excludePath)
    ? fs.readFileSync(excludePath, "utf8")
    : "";
  const lines = existing.split(/\r?\n/).map((line) => line.trim());

  if (lines.includes(generated)) return;

  const separator = existing && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(excludePath, `${separator}${generated}\n`, "utf8");
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

function writeGenerated(inboxPath, source) {
  const marker = source.split("\n", 1)[0];
  fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
  if (fs.existsSync(inboxPath) && fs.readFileSync(inboxPath, "utf8").split("\n", 1)[0] === marker) {
    return false;
  }
  const temporary = `${inboxPath}.tmp`;
  fs.writeFileSync(temporary, source, "utf8");
  fs.rmSync(inboxPath, { force: true });
  fs.renameSync(temporary, inboxPath);
  return true;
}

// The telemetry the server has: addon stream key -> record fingerprint. On
// its next login the addon drops matching records from SavedVariables, so
// delivered data is not carried (in memory and in every save) until the
// outbound queue's cap. Kept apart from the quest inbox so it is written
// without a network round trip.
export function telemetryAcksSource(acknowledged, digest) {
  return `-- Guildweaver Bridge telemetry acknowledgements ${digest || "none"}\nlocal _, GW = ...\n\nGW.BridgeAcks = ${luaValue({
    schemaVersion: 1,
    telemetry: acknowledged,
  })}\n`;
}

export function writeTelemetryAcks(config, acknowledged, digest) {
  const addonPath = findAddonPath(config);
  excludeGeneratedInboxFromCheckout(addonPath, GENERATED_ACKS);
  const acksPath = path.join(addonPath, ...GENERATED_ACKS.split("/"));
  return { path: acksPath, changed: writeGenerated(acksPath, telemetryAcksSource(acknowledged, digest)) };
}

export function writeBridgeInbox(config, payload) {
  const addonPath = findAddonPath(config);
  excludeGeneratedInboxFromCheckout(addonPath);

  const inboxPath = path.join(addonPath, ...GENERATED_INBOX.split("/"));
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

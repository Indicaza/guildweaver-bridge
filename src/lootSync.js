// Loot inbox: the player's character wishlists and the valuable
// Bind-on-Equip watchlist, fetched from the website and written into the
// add-on folder as Data/BridgeLoot.generated.lua.
//
// It has its own change tracking, apart from the quest inbox: the file is
// rewritten when its own content digest changes, so a wishlist edit reaches
// the game whether or not a quest did. WoW reads the file at login or
// /reload, never while playing.
//
// Whatever goes wrong (the website is down or older, the answer is not
// what the contract says, it is older than what was last written), the
// file already in the add-on folder is left exactly as it is: the add-on
// keeps the last valid wishlist. Nothing here can fail quest sync or
// telemetry delivery.

import { createHash } from "node:crypto";

import { readGeneratedMarker, writeLootInbox } from "./bridgeInbox.js";

export const LOOT_SCHEMA_VERSION = 1;
// Bounds on what is written into the game folder, whatever the server sends.
export const LOOT_LIMITS = Object.freeze({
  responseBytes: 2 * 1024 * 1024,
  characters: 20,
  aliases: 8,
  wishlistItems: 200,
  markets: 4,
  boeItems: 300,
  note: 140,
  name: 80,
  key: 160,
});
// An older website has no loot endpoint: ask again this often, not every poll.
const UNSUPPORTED_RETRY_MS = 30 * 60 * 1000;
const PRIORITIES = new Set(["high", "normal", "low"]);
const CONFIDENCES = new Set(["high", "medium"]);
const ITEM_KEY = /^i:(\d+)(:s-?\d+)?(:b\d+(\.\d+)*)?$/;

export function emptyLootState() {
  return { etag: "", digest: "", revision: 0, generatedAt: 0, lastSyncAt: 0, unsupportedUntil: 0 };
}

export function readLootState(value) {
  const state = emptyLootState();
  if (!value || typeof value !== "object") return state;
  for (const key of ["etag", "digest"]) if (typeof value[key] === "string") state[key] = value[key];
  for (const key of ["revision", "generatedAt", "lastSyncAt", "unsupportedUntil"]) {
    if (Number.isFinite(Number(value[key])) && Number(value[key]) > 0) state[key] = Number(value[key]);
  }
  return state;
}

class InvalidSnapshot extends Error {}

function fail(message) {
  throw new InvalidSnapshot(message);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be a whole number`);
  return value;
}

function text(value, label, max, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return "";
    fail(`${label} is missing`);
  }
  if (typeof value !== "string") fail(`${label} must be text`);
  return value.slice(0, max);
}

function list(value, label) {
  // An empty Lua-style table ({}) is an empty list.
  if (isObject(value) && Object.keys(value).length === 0) return [];
  if (!Array.isArray(value)) fail(`${label} must be a list`);
  return value;
}

function itemKey(value, itemId, label) {
  const match = typeof value === "string" ? ITEM_KEY.exec(value) : null;
  if (!match || Number(match[1]) !== itemId) fail(`${label} is not a key of item ${itemId}`);
  return value;
}

function wishlistItem(raw, label) {
  if (!isObject(raw)) fail(`${label} must be an object`);
  const itemId = integer(raw.itemId, `${label}.itemId`, { min: 1, max: 2147483647 });
  if (!PRIORITIES.has(raw.priority)) fail(`${label}.priority is not high, normal or low`);
  return {
    itemId,
    itemKey: itemKey(raw.itemKey, itemId, `${label}.itemKey`),
    priority: raw.priority,
    note: text(raw.note, `${label}.note`, LOOT_LIMITS.note, { optional: true }),
    name: text(raw.name, `${label}.name`, LOOT_LIMITS.name, { optional: true }),
    qualityId: raw.qualityId === undefined || raw.qualityId === null ? null : integer(raw.qualityId, `${label}.qualityId`, { max: 20 }),
    source: text(raw.source, `${label}.source`, LOOT_LIMITS.name, { optional: true }),
  };
}

function character(raw, label, markets) {
  if (!isObject(raw)) fail(`${label} must be an object`);
  if (!isObject(raw.wishlist)) fail(`${label}.wishlist is missing`);
  const marketKey = raw.marketKey === undefined || raw.marketKey === null ? null : text(raw.marketKey, `${label}.marketKey`, LOOT_LIMITS.key);
  const seen = new Set();
  const items = [];
  for (const [index, entry] of list(raw.wishlist.items, `${label}.wishlist.items`).entries()) {
    const item = wishlistItem(entry, `${label}.wishlist.items[${index}]`);
    // The same identity twice would alert twice: the first one stands.
    if (seen.has(item.itemKey)) continue;
    seen.add(item.itemKey);
    if (items.length < LOOT_LIMITS.wishlistItems) items.push(item);
  }
  return {
    id: text(raw.id, `${label}.id`, 400),
    name: text(raw.name, `${label}.name`, LOOT_LIMITS.name),
    realm: text(raw.realm, `${label}.realm`, 120, { optional: true }),
    region: text(raw.region, `${label}.region`, 32, { optional: true }),
    aliases: list(raw.aliases ?? [], `${label}.aliases`).slice(0, LOOT_LIMITS.aliases).map((alias, index) => text(alias, `${label}.aliases[${index}]`, 400)),
    // A market the snapshot does not carry cannot value anything.
    marketKey: marketKey && markets.has(marketKey) ? marketKey : null,
    wishlist: { revision: integer(raw.wishlist.revision ?? 0, `${label}.wishlist.revision`), updatedAt: integer(raw.wishlist.updatedAt ?? 0, `${label}.wishlist.updatedAt`), items },
  };
}

function boeItem(raw, label) {
  if (!isObject(raw)) fail(`${label} must be an object`);
  const itemId = integer(raw.itemId, `${label}.itemId`, { min: 1, max: 2147483647 });
  if (!CONFIDENCES.has(raw.confidence)) fail(`${label}.confidence is not high or medium`);
  return {
    itemKey: itemKey(raw.itemKey, itemId, `${label}.itemKey`),
    itemId,
    value: integer(raw.value, `${label}.value`, { min: 1, max: 1e12 }),
    observedAt: integer(raw.observedAt, `${label}.observedAt`, { min: 1 }),
    confidence: raw.confidence,
  };
}

// The website's answer as the bounded, checked document that is written to
// disk. Throws on anything the contract does not allow: a malformed part
// rejects the whole snapshot, because a half-read wishlist is worse than
// yesterday's. Lists longer than the bounds are cut, not refused.
export function normalizeLootSnapshot(body) {
  if (!isObject(body)) fail("the snapshot must be an object");
  if (body.schemaVersion !== LOOT_SCHEMA_VERSION) fail(`unsupported loot snapshot schema ${JSON.stringify(body.schemaVersion)}`);
  const boe = isObject(body.boe) ? body.boe : fail("boe is missing");
  const markets = {};
  for (const [key, market] of Object.entries(isObject(boe.markets) ? boe.markets : {}).slice(0, LOOT_LIMITS.markets)) {
    if (!isObject(market)) fail(`boe.markets[${key}] must be an object`);
    const items = list(market.items, `boe.markets[${key}].items`).slice(0, LOOT_LIMITS.boeItems).map((entry, index) => boeItem(entry, `boe.markets[${key}].items[${index}]`));
    markets[text(key, "boe market key", LOOT_LIMITS.key)] = { name: text(market.name, `boe.markets[${key}].name`, LOOT_LIMITS.name, { optional: true }), items };
  }
  const known = new Set(Object.keys(markets));
  const snapshot = {
    schemaVersion: LOOT_SCHEMA_VERSION,
    revision: integer(body.revision, "revision"),
    generatedAt: integer(body.generatedAt, "generatedAt", { min: 1 }),
    characters: list(body.characters, "characters").slice(0, LOOT_LIMITS.characters).map((entry, index) => character(entry, `characters[${index}]`, known)),
    boe: { floorCopper: integer(boe.floorCopper, "boe.floorCopper", { min: 1 }), maxAgeSeconds: integer(boe.maxAgeSeconds, "boe.maxAgeSeconds", { min: 60 }), markets },
  };
  return { ...snapshot, digest: lootContentDigest(snapshot) };
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

// A digest of what the add-on will read, without the time it was generated:
// the same wishlists and values are the same file.
export function lootContentDigest({ revision, characters, boe }) {
  return createHash("sha256").update(stable({ revision, characters, boe })).digest("hex").slice(0, 16);
}

// Lua string: every control character escaped, so website text can only
// ever be data.
function quote(value) {
  let out = '"';
  for (const character of String(value)) {
    const code = character.codePointAt(0);
    if (character === "\\") out += "\\\\";
    else if (character === '"') out += '\\"';
    else if (code < 32 || code === 127) out += `\\${String(code).padStart(3, "0")}`;
    else out += character;
  }
  return `${out}"`;
}

function number(value) {
  if (!Number.isFinite(value)) throw new Error("Cannot serialize a non-finite Lua number");
  return String(value);
}

// One item per line and short keys for the watchlist, so the file stays
// small: a few hundred bytes per wishlist item, about fifty per BoE item.
export function lootInboxSource(snapshot) {
  const lines = [`-- Guildweaver Bridge loot ${snapshot.digest}`, "local _, GW = ...", "", "GW.BridgeLoot = {",
    `    schemaVersion = ${LOOT_SCHEMA_VERSION}, digest = ${quote(snapshot.digest)}, revision = ${number(snapshot.revision)}, generatedAt = ${number(snapshot.generatedAt)},`,
    "    characters = {"];
  for (const entry of snapshot.characters) {
    lines.push(`        { id = ${quote(entry.id)}, name = ${quote(entry.name)}, realm = ${quote(entry.realm)}, region = ${quote(entry.region)},`
      + `${entry.marketKey ? ` marketKey = ${quote(entry.marketKey)},` : ""} aliases = { ${entry.aliases.map(quote).join(", ")} },`);
    lines.push(`          wishlist = { revision = ${number(entry.wishlist.revision)}, updatedAt = ${number(entry.wishlist.updatedAt)}, items = {`);
    for (const item of entry.wishlist.items) {
      lines.push(`            { itemId = ${number(item.itemId)}, itemKey = ${quote(item.itemKey)}, priority = ${quote(item.priority)}`
        + `${item.note ? `, note = ${quote(item.note)}` : ""}${item.name ? `, name = ${quote(item.name)}` : ""}`
        + `${item.qualityId === null ? "" : `, qualityId = ${number(item.qualityId)}`}${item.source ? `, source = ${quote(item.source)}` : ""} },`);
    }
    lines.push("          } } },");
  }
  lines.push("    },", `    boe = { floorCopper = ${number(snapshot.boe.floorCopper)}, maxAgeSeconds = ${number(snapshot.boe.maxAgeSeconds)}, markets = {`);
  for (const [key, market] of Object.entries(snapshot.boe.markets).sort(([left], [right]) => (left < right ? -1 : 1))) {
    lines.push(`        [${quote(key)}] = { name = ${quote(market.name)}, items = {`);
    // k: item key, id: item id, v: copper, t: observed at, c: confidence.
    for (const item of market.items) {
      lines.push(`            { k = ${quote(item.itemKey)}, id = ${number(item.itemId)}, v = ${number(item.value)}, t = ${number(item.observedAt)}, c = ${quote(item.confidence)} },`);
    }
    lines.push("        } },");
  }
  lines.push("    } },", "}", "");
  return lines.join("\n");
}

async function fetchSnapshot(config, etag, fetchImpl) {
  const response = await fetchImpl(`${config.holdfastUrl}/api/bridge/loot/snapshot`, {
    headers: { Authorization: `Bearer ${config.deviceToken}`, ...(etag ? { "If-None-Match": `"${etag}"` } : {}) },
  });
  if (response.status === 304) return { status: 304 };
  const raw = await response.text();
  if (!response.ok) return { status: response.status, raw };
  return { status: 200, raw, etag: String(response.headers?.get?.("etag") || "").replace(/^W\//, "").replace(/"/g, "") };
}

// One loot sync, when it is due. Changes `state` (the bridge state's loot
// section) and returns what happened:
//   skipped      not due yet, or the bridge is not paired
//   unsupported  the website has no loot endpoint (older release)
//   unchanged    the website has nothing newer than the file
//   updated      a new file was written
//   stale        the answer is older than what was last written; ignored
//   invalid      the answer broke the contract; the file was not touched
//   failed       no answer (offline, server error); tried again next time
export async function syncLoot(config, state, { fetchImpl = fetch, log = console.log, now = Date.now } = {}) {
  const timestamp = now();
  if (!config.lootSyncIntervalMs || !config.deviceToken || !config.holdfastUrl) return { status: "skipped" };
  if (timestamp < state.unsupportedUntil) return { status: "skipped" };
  if (state.lastSyncAt && timestamp >= state.lastSyncAt && timestamp - state.lastSyncAt < config.lootSyncIntervalMs) return { status: "skipped" };

  // The file must still be the one last written: after an add-on update or
  // a damaged file, the whole snapshot is fetched and written again.
  let marker = null;
  try {
    marker = readGeneratedMarker(config);
  } catch {
    marker = null;
  }
  const fileCurrent = Boolean(state.digest) && marker === `-- Guildweaver Bridge loot ${state.digest}`;

  let answer;
  try {
    answer = await fetchSnapshot(config, fileCurrent ? state.etag : "", fetchImpl);
  } catch (error) {
    state.lastSyncAt = timestamp;
    log(`Loot sync will retry: ${error.message}`);
    return { status: "failed" };
  }
  state.lastSyncAt = timestamp;

  if (answer.status === 304) return { status: "unchanged" };
  if (answer.status === 404) {
    state.unsupportedUntil = timestamp + UNSUPPORTED_RETRY_MS;
    return { status: "unsupported" };
  }
  if (answer.status !== 200) {
    // A revoked device is the quest sync's to report and repair.
    if (answer.status !== 401) log(`Loot sync will retry: Holdfast answered HTTP ${answer.status}.`);
    return { status: "failed", httpStatus: answer.status };
  }

  let snapshot;
  try {
    if (Buffer.byteLength(answer.raw, "utf8") > LOOT_LIMITS.responseBytes) fail("the snapshot is too large");
    let body;
    try {
      body = JSON.parse(answer.raw);
    } catch {
      fail("the snapshot is not JSON");
    }
    snapshot = normalizeLootSnapshot(body);
  } catch (error) {
    if (!(error instanceof InvalidSnapshot)) throw error;
    log(`Ignored an invalid loot snapshot (${error.message}); the wishlist already in the add-on is kept.`);
    return { status: "invalid", error: error.message };
  }

  // Older than what is on disk (a delayed answer, a lagging replica): the
  // newer file stays. A lower revision generated later is the website
  // itself having been restored, and is accepted.
  if (fileCurrent && (snapshot.generatedAt < state.generatedAt || (snapshot.generatedAt === state.generatedAt && snapshot.revision < state.revision))) {
    log(`Ignored a stale loot snapshot (revision ${snapshot.revision}, older than the one in the add-on).`);
    return { status: "stale" };
  }

  let written;
  try {
    written = writeLootInbox(config, lootInboxSource(snapshot));
  } catch (error) {
    log(`Could not write the loot inbox: ${error.message}`);
    return { status: "failed" };
  }
  Object.assign(state, { etag: answer.etag, digest: snapshot.digest, revision: snapshot.revision, generatedAt: snapshot.generatedAt });
  if (!written.changed) return { status: "unchanged" };
  const wanted = snapshot.characters.reduce((sum, entry) => sum + entry.wishlist.items.length, 0);
  log(`Loot inbox updated (wishlist revision ${snapshot.revision}, ${wanted} wanted item${wanted === 1 ? "" : "s"} on ${snapshot.characters.length} character${snapshot.characters.length === 1 ? "" : "s"}); /reload to apply in WoW.`);
  return { status: "updated", revision: snapshot.revision, characters: snapshot.characters.length, wanted };
}

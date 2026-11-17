import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

import { LOOT_LIMITS, lootContentDigest, lootInboxSource, normalizeLootSnapshot } from "../src/lootSync.js";
import { parseSavedVariables } from "../src/savedVariables.js";
import { syncOnce } from "../src/sync.js";

// The loot inbox: character wishlists and the valuable-BoE watchlist, with
// their own schedule, digest and file. Nothing here may disturb quest sync
// or telemetry, and nothing may replace a valid file with a worse one.

const MARKET = "game:us:live-realm:alliance";

function lootSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: 1791761400,
    revision: 5,
    digest: "serverdigest00001",
    characters: [
      {
        id: "guildweaver-id:character-rook", name: "Rook Shepard", realm: "Live Realm", region: "US", aliases: ["character-rook"], marketKey: MARKET,
        wishlist: { revision: 3, updatedAt: 1791761000, items: [
          { itemId: 5191, itemKey: "i:5191", priority: "high", note: "Main hand", name: "Cruel Barb", qualityId: 3, source: "The Deadmines" },
          { itemId: 6468, itemKey: "i:6468:s-1081", priority: "low", note: "", name: "Deviate Scale Belt", qualityId: 3, source: "" },
        ] },
      },
      {
        id: "guildweaver-id:character-fern", name: "Fern", realm: "Live Realm", region: "US", aliases: ["character-fern", "character-fern-laptop"], marketKey: null,
        wishlist: { revision: 2, updatedAt: 1791760000, items: [{ itemId: 5193, itemKey: "i:5193", priority: "normal", note: "", name: "Cape of the Brotherhood", qualityId: 2, source: "" }] },
      },
    ],
    boe: { floorCopper: 10000, maxAgeSeconds: 259200, markets: { [MARKET]: { name: "Live Realm Alliance", items: [
      { itemKey: "i:6694", itemId: 6694, value: 250000, observedAt: 1791760800, confidence: "medium" },
      { itemKey: "i:6468:s-1081", itemId: 6468, value: 300000, observedAt: 1791760800, confidence: "high" },
    ] } } },
    ...overrides,
  };
}

function questSnapshot(revision = 9) {
  return { schemaVersion: 1, revision, updatedAt: "2026-10-05T20:00:00.000Z", synced: true, items: [] };
}

const SAVED_VARIABLES = `GuildweaverDB = {
  ["gameRelease"] = "forever-live",
  ["schemaVersion"] = 4,
  ["sync"] = { ["outbound"] = { ["telemetry"] = {
    ["stats:character-rook"] = { ["kind"] = "state", ["revision"] = 1, ["fingerprint"] = "abc12345",
      ["envelope"] = { ["schemaVersion"] = 1, ["eventType"] = "stats", ["capturedAt"] = 1791320496, ["characterId"] = "character-rook",
        ["payload"] = { ["schemaVersion"] = 1, ["value"] = 1 } } },
  }, ["questActions"] = {} } },
}`;

function setup({ questSyncIntervalMs = Number.MAX_SAFE_INTEGER, lootSyncIntervalMs = 60_000 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-loot-sync-"));
  const addonPath = path.join(directory, "AddOns", "Guildweaver");
  fs.mkdirSync(path.join(addonPath, "Data"), { recursive: true });
  const savedVariablesPath = path.join(directory, "Guildweaver.lua");
  fs.writeFileSync(savedVariablesPath, SAVED_VARIABLES, "utf8");
  const config = { holdfastUrl: "https://holdfast.example", telemetryEndpoint: "https://holdfast.example/api/bridge/telemetry", deviceToken: "gwd_secret",
    savedVariablesPath, addonPath, wowRoot: null, pollIntervalMs: 1000, questSyncIntervalMs, lootSyncIntervalMs, statePath: path.join(directory, "state.json") };
  const lootPath = path.join(addonPath, "Data", "BridgeLoot.generated.lua");
  const server = { loot: lootSnapshot(), lootStatus: 200, lootRaw: null, offline: false, quests: questSnapshot(), requests: [] };
  const fetchImpl = async (url, options = {}) => {
    server.requests.push({ url, options });
    if (url.endsWith("/api/bridge/loot/snapshot")) {
      if (server.offline) throw new Error("fetch failed");
      if (server.lootStatus !== 200) return new Response(JSON.stringify({ error: "nope" }), { status: server.lootStatus });
      const etag = `"${server.loot.digest}"`;
      if (options.headers?.["If-None-Match"] === etag && server.lootRaw === null) return new Response(null, { status: 304, headers: { ETag: etag } });
      return new Response(server.lootRaw ?? JSON.stringify(server.loot), { status: 200, headers: { "Content-Type": "application/json", ETag: etag } });
    }
    if (url.endsWith("/api/bridge/quests/snapshot")) return new Response(JSON.stringify(server.quests), { status: 200 });
    if (url.endsWith("/api/bridge/telemetry")) return new Response(JSON.stringify({ status: "created" }), { status: 201 });
    throw new Error(`Unexpected request: ${url}`);
  };
  let clock = 1_000_000;
  const logs = [];
  const sync = (advanceMs = 60_000) => {
    clock += advanceMs;
    return syncOnce(config, { fetchImpl, log: (line) => logs.push(line), now: () => clock, fileCache: new Map() });
  };
  const readLoot = () => parseSavedVariables(fs.readFileSync(lootPath, "utf8"), "GW\\.BridgeLoot");
  const lootRequests = () => server.requests.filter((request) => request.url.endsWith("/loot/snapshot"));
  const state = () => JSON.parse(fs.readFileSync(config.statePath, "utf8"));
  return { directory, config, lootPath, server, sync, readLoot, lootRequests, state, logs, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test("the first sync writes wishlists and the watchlist as Lua the add-on can load", async () => {
  const context = setup();
  try {
    const result = await context.sync();
    assert.equal(result.lootSync, "updated");
    const source = fs.readFileSync(context.lootPath, "utf8");
    assert.match(source, /^-- Guildweaver Bridge loot [0-9a-f]{16}\nlocal _, GW = \.\.\.\n\nGW\.BridgeLoot = \{/);
    const loot = context.readLoot();
    assert.equal(loot.schemaVersion, 1);
    assert.equal(loot.revision, 5);
    assert.equal(loot.generatedAt, 1791761400);
    assert.equal(loot.characters.length, 2, "every character of the account");
    const [rook, fern] = loot.characters;
    // What the add-on matches the logged-in character on.
    assert.deepEqual([rook.id, rook.name, rook.realm, rook.region, rook.aliases], ["guildweaver-id:character-rook", "Rook Shepard", "Live Realm", "US", ["character-rook"]]);
    assert.deepEqual(fern.aliases, ["character-fern", "character-fern-laptop"]);
    assert.equal(rook.marketKey, MARKET);
    assert.equal(fern.marketKey, undefined, "no market: no gold alerts for that character");
    assert.deepEqual(rook.wishlist.items[0], { itemId: 5191, itemKey: "i:5191", priority: "high", note: "Main hand", name: "Cruel Barb", qualityId: 3, source: "The Deadmines" });
    assert.deepEqual(rook.wishlist.items[1], { itemId: 6468, itemKey: "i:6468:s-1081", priority: "low", name: "Deviate Scale Belt", qualityId: 3 });
    assert.equal(rook.wishlist.revision, 3);
    assert.deepEqual(loot.boe.markets[MARKET].items, [{ k: "i:6694", id: 6694, v: 250000, t: 1791760800, c: "medium" }, { k: "i:6468:s-1081", id: 6468, v: 300000, t: 1791760800, c: "high" }]);
    assert.equal(loot.boe.floorCopper, 10000);
    assert.equal(loot.boe.maxAgeSeconds, 259200);
    assert.equal(fs.existsSync(`${context.lootPath}.tmp`), false, "no temporary file is left behind");
    assert.equal(context.lootRequests()[0].options.headers.Authorization, "Bearer gwd_secret");
    assert.deepEqual(context.state().loot.revision, 5);
    assert.match(context.logs.join("\n"), /Loot inbox updated \(wishlist revision 5, 3 wanted items on 2 characters\); \/reload to apply in WoW\./);
  } finally {
    context.cleanup();
  }
});

test("a wishlist change reaches the add-on while quests are unchanged, and the reverse", async () => {
  const context = setup({ questSyncIntervalMs: 15_000 });
  const inboxPath = path.join(context.config.addonPath, "Data", "BridgeInbox.generated.lua");
  try {
    const first = await context.sync();
    assert.equal(first.lootSync, "updated");
    assert.equal(first.questSnapshotUpdated, true);
    const questWritten = fs.readFileSync(inboxPath, "utf8");
    const lootWritten = fs.readFileSync(context.lootPath, "utf8");
    assert.match(questWritten, /^-- Guildweaver Bridge inbox 9:/, "the quest marker is still the quest revision alone");

    // The wishlist changes; the quest revision does not.
    context.server.loot = lootSnapshot({ revision: 6, generatedAt: 1791761500, digest: "serverdigest00002",
      characters: [{ ...lootSnapshot().characters[0], wishlist: { revision: 4, updatedAt: 1791761450, items: [lootSnapshot().characters[0].wishlist.items[0]] } }] });
    const second = await context.sync();
    assert.equal(second.lootSync, "updated");
    assert.equal(second.questSnapshotUpdated, false);
    assert.equal(fs.readFileSync(inboxPath, "utf8"), questWritten, "the quest inbox was not rewritten");
    assert.notEqual(fs.readFileSync(context.lootPath, "utf8"), lootWritten);
    assert.equal(context.readLoot().characters[0].wishlist.items.length, 1);

    // A quest changes; the wishlist does not.
    const lootNow = fs.readFileSync(context.lootPath, "utf8");
    const lootMtime = fs.statSync(context.lootPath).mtimeMs;
    context.server.quests = questSnapshot(10);
    const third = await context.sync();
    assert.equal(third.questSnapshotUpdated, true);
    assert.equal(third.lootSync, "unchanged");
    assert.equal(fs.readFileSync(context.lootPath, "utf8"), lootNow);
    assert.equal(fs.statSync(context.lootPath).mtimeMs, lootMtime, "the loot inbox was not rewritten");
    assert.match(fs.readFileSync(inboxPath, "utf8"), /^-- Guildweaver Bridge inbox 10:/);
  } finally {
    context.cleanup();
  }
});

test("nothing new costs one conditional request, and only when due", async () => {
  const context = setup();
  try {
    await context.sync();
    const written = fs.statSync(context.lootPath).mtimeMs;
    assert.equal((await context.sync(1000)).lootSync, "skipped", "not due yet");
    assert.equal(context.lootRequests().length, 1);
    const again = await context.sync();
    assert.equal(again.lootSync, "unchanged");
    assert.equal(context.lootRequests()[1].options.headers["If-None-Match"], '"serverdigest00001"');
    assert.equal(fs.statSync(context.lootPath).mtimeMs, written);
    // The same content under a new server digest (only generatedAt moved) is still not a rewrite.
    context.server.loot = lootSnapshot({ generatedAt: 1791769999, digest: "serverdigest00009" });
    assert.equal((await context.sync()).lootSync, "unchanged");
    assert.equal(fs.statSync(context.lootPath).mtimeMs, written, "repeated delivery is safe");
  } finally {
    context.cleanup();
  }
});

test("offline, the file already in the add-on stays, and the sync retries", async () => {
  const context = setup();
  try {
    context.server.offline = true;
    assert.equal((await context.sync()).lootSync, "failed");
    assert.equal(fs.existsSync(context.lootPath), false, "nothing is written without an answer");
    context.server.offline = false;
    assert.equal((await context.sync()).lootSync, "updated");
    const good = fs.readFileSync(context.lootPath, "utf8");

    context.server.loot = lootSnapshot({ revision: 6, generatedAt: 1791761500, digest: "serverdigest00002", characters: [] });
    context.server.offline = true;
    assert.equal((await context.sync()).lootSync, "failed");
    context.server.offline = false;
    context.server.lootStatus = 503;
    assert.equal((await context.sync()).lootSync, "failed");
    assert.equal(fs.readFileSync(context.lootPath, "utf8"), good, "the last valid wishlist is kept while the website is unreachable");
    context.server.lootStatus = 200;
    assert.equal((await context.sync()).lootSync, "updated");
    assert.equal(context.readLoot().revision, 6);
  } finally {
    context.cleanup();
  }
});

test("a broken answer never replaces a valid file", async () => {
  const context = setup();
  try {
    await context.sync();
    const good = fs.readFileSync(context.lootPath, "utf8");
    const bad = [
      "<html>502 Bad Gateway</html>",
      "{ \"schemaVersion\": 1, ",
      JSON.stringify({ ...lootSnapshot(), schemaVersion: 2 }),
      JSON.stringify({ ...lootSnapshot(), revision: "6" }),
      JSON.stringify({ ...lootSnapshot(), characters: "none" }),
      JSON.stringify({ ...lootSnapshot(), boe: undefined }),
      JSON.stringify(lootSnapshot({ characters: [{ ...lootSnapshot().characters[0], wishlist: { revision: 1, updatedAt: 1, items: [{ itemId: "5191", itemKey: "i:5191", priority: "high" }] } }] })),
      JSON.stringify(lootSnapshot({ characters: [{ ...lootSnapshot().characters[0], wishlist: { revision: 1, updatedAt: 1, items: [{ itemId: 5191, itemKey: "i:999", priority: "high" }] } }] })),
      JSON.stringify(lootSnapshot({ characters: [{ ...lootSnapshot().characters[0], wishlist: { revision: 1, updatedAt: 1, items: [{ itemId: 5191, itemKey: "i:5191", priority: "urgent" }] } }] })),
      JSON.stringify(lootSnapshot({ boe: { floorCopper: 10000, maxAgeSeconds: 259200, markets: { [MARKET]: { name: "x", items: [{ itemKey: "i:1", itemId: 1, value: -5, observedAt: 1, confidence: "medium" }] } } } })),
      JSON.stringify(lootSnapshot({ boe: { floorCopper: 10000, maxAgeSeconds: 259200, markets: { [MARKET]: { name: "x", items: [{ itemKey: "i:1", itemId: 1, value: 5, observedAt: 1, confidence: "low" }] } } } })),
      JSON.stringify([lootSnapshot()]),
      "x".repeat(LOOT_LIMITS.responseBytes + 1),
    ];
    for (const raw of bad) {
      context.server.lootRaw = raw;
      const result = await context.sync();
      assert.equal(result.lootSync, "invalid", raw.slice(0, 60));
      assert.equal(fs.readFileSync(context.lootPath, "utf8"), good, "the valid file is untouched");
    }
    assert.match(context.logs.join("\n"), /Ignored an invalid loot snapshot .*; the wishlist already in the add-on is kept\./);
    assert.equal(context.state().loot.revision, 5, "the state still describes the file on disk");
    // Recovery: the next valid answer is written.
    context.server.lootRaw = null;
    context.server.loot = lootSnapshot({ revision: 7, generatedAt: 1791762000, digest: "serverdigest00003" });
    assert.equal((await context.sync()).lootSync, "updated");
    assert.equal(context.readLoot().revision, 7);
  } finally {
    context.cleanup();
  }
});

test("an older answer is rejected; a restored website is accepted", async () => {
  const context = setup();
  try {
    context.server.loot = lootSnapshot({ revision: 9, generatedAt: 1791770000, digest: "serverdigest00005" });
    await context.sync();
    // A delayed answer generated before the one on disk.
    context.server.loot = lootSnapshot({ revision: 8, generatedAt: 1791769000, digest: "serverdigest00004", characters: [] });
    assert.equal((await context.sync()).lootSync, "stale");
    assert.equal(context.readLoot().revision, 9, "the newer file stays");
    assert.equal(context.readLoot().characters.length, 2);
    assert.match(context.logs.join("\n"), /Ignored a stale loot snapshot/);
    // The same instant with a lower revision is stale too.
    context.server.loot = lootSnapshot({ revision: 8, generatedAt: 1791770000, digest: "serverdigest00006", characters: [] });
    assert.equal((await context.sync()).lootSync, "stale");
    // A lower revision generated later: the website's data was restored. Its word stands.
    context.server.loot = lootSnapshot({ revision: 2, generatedAt: 1791780000, digest: "serverdigest00007" });
    assert.equal((await context.sync()).lootSync, "updated");
    assert.equal(context.readLoot().revision, 2);
  } finally {
    context.cleanup();
  }
});

test("a missing or damaged file is written again in full", async () => {
  const context = setup();
  try {
    await context.sync();
    const good = fs.readFileSync(context.lootPath, "utf8");
    // An add-on update replaced the folder.
    fs.rmSync(context.lootPath);
    assert.equal((await context.sync()).lootSync, "updated");
    assert.equal(context.lootRequests().at(-1).options.headers["If-None-Match"], undefined, "no conditional request when the file is not the one last written");
    assert.equal(fs.readFileSync(context.lootPath, "utf8"), good);
    // Something else wrote over it.
    fs.writeFileSync(context.lootPath, "-- not ours\nGW.BridgeLoot = nil\n", "utf8");
    assert.equal((await context.sync()).lootSync, "updated");
    assert.equal(fs.readFileSync(context.lootPath, "utf8"), good);
    // A lost bridge state with the file intact: fetched in full, found identical, not rewritten.
    fs.rmSync(context.config.statePath);
    const written = fs.statSync(context.lootPath).mtimeMs;
    assert.equal((await context.sync()).lootSync, "unchanged");
    assert.equal(fs.statSync(context.lootPath).mtimeMs, written);
  } finally {
    context.cleanup();
  }
});

test("a failed write leaves the old file whole and no temporary file", async () => {
  const context = setup();
  try {
    await context.sync();
    const good = fs.readFileSync(context.lootPath, "utf8");
    context.server.loot = lootSnapshot({ revision: 6, generatedAt: 1791761500, digest: "serverdigest00002", characters: [] });
    const rename = mock.method(fs, "renameSync", () => { throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }); });
    try {
      assert.equal((await context.sync()).lootSync, "failed");
    } finally {
      rename.mock.restore();
    }
    assert.equal(fs.readFileSync(context.lootPath, "utf8"), good, "the file is replaced whole or not at all");
    assert.equal(fs.existsSync(`${context.lootPath}.tmp`), false);
    assert.equal(context.state().loot.revision, 5);
    assert.equal((await context.sync()).lootSync, "updated", "the next pass writes it");
  } finally {
    context.cleanup();
  }
});

test("what is written is bounded, whatever the website sends", async () => {
  const context = setup();
  try {
    const manyItems = Array.from({ length: 500 }, (_, index) => ({ itemId: 1000 + index, itemKey: `i:${1000 + index}`, priority: "normal", note: "n".repeat(500), name: "x".repeat(300), qualityId: 2, source: "s".repeat(300) }));
    const manyCharacters = Array.from({ length: 40 }, (_, index) => ({ id: `c${index}`, name: `Character ${index}`, realm: "Live Realm", region: "US",
      aliases: Array.from({ length: 30 }, (_, alias) => `alias-${index}-${alias}`), marketKey: index === 0 ? MARKET : `game:us:other-${index}:alliance`,
      wishlist: { revision: 1, updatedAt: 1, items: index === 0 ? [...manyItems, manyItems[0]] : [] } }));
    const markets = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index === 0 ? MARKET : `game:us:realm-${index}:alliance`, { name: "m",
      items: Array.from({ length: 800 }, (_, item) => ({ itemKey: `i:${5000 + item}`, itemId: 5000 + item, value: 20000 + item, observedAt: 1791760800, confidence: "medium" })) }]));
    context.server.loot = lootSnapshot({ characters: manyCharacters, boe: { floorCopper: 10000, maxAgeSeconds: 259200, markets } });
    assert.equal((await context.sync()).lootSync, "updated");
    const loot = context.readLoot();
    assert.equal(loot.characters.length, LOOT_LIMITS.characters);
    assert.equal(loot.characters[0].wishlist.items.length, LOOT_LIMITS.wishlistItems);
    assert.equal(loot.characters[0].wishlist.items[0].note.length, LOOT_LIMITS.note);
    assert.equal(loot.characters[0].wishlist.items[0].name.length, LOOT_LIMITS.name);
    assert.equal(loot.characters[0].aliases.length, LOOT_LIMITS.aliases);
    assert.equal(Object.keys(loot.boe.markets).length, LOOT_LIMITS.markets);
    assert.equal(loot.boe.markets[MARKET].items.length, LOOT_LIMITS.boeItems);
    assert.equal(loot.characters[1].marketKey, undefined, "a market that was cut cannot value anything");
    assert.ok(fs.statSync(context.lootPath).size < 200 * 1024, `the file stays small (${fs.statSync(context.lootPath).size} bytes)`);
  } finally {
    context.cleanup();
  }
});

test("website text is only ever Lua data", () => {
  const hostile = 'Evil" }, } os.exit() --[[ \\ \n]] \r\t\u0000';
  const snapshot = normalizeLootSnapshot(lootSnapshot({ characters: [{ ...lootSnapshot().characters[0], name: hostile.slice(0, 60),
    wishlist: { revision: 1, updatedAt: 1, items: [{ itemId: 5191, itemKey: "i:5191", priority: "high", note: hostile, name: hostile, qualityId: 3, source: hostile }] } }] }));
  const source = lootInboxSource(snapshot);
  assert.equal(source.split("\n").filter((line) => line.includes("os.exit")).every((line) => /^\s+\{ (id|itemId) = /.test(line)), true, "the text stays inside its table row");
  assert.ok(!/[\r\t\u0000]/.test(source), "no raw control characters reach the file");
  const loot = parseSavedVariables(source, "GW\\.BridgeLoot");
  assert.equal(loot.characters[0].wishlist.items[0].note, hostile, "and it round-trips exactly");
  assert.equal(loot.characters[0].name, hostile.slice(0, 60));
  // The digest is of the content, not of when it was generated.
  assert.equal(lootContentDigest(snapshot), lootContentDigest({ ...snapshot, generatedAt: 5 }));
  assert.notEqual(lootContentDigest(snapshot), lootContentDigest({ ...snapshot, revision: snapshot.revision + 1 }));
});

test("an older website without the loot endpoint is asked rarely, and nothing else is disturbed", async () => {
  const context = setup({ questSyncIntervalMs: 15_000 });
  const inboxPath = path.join(context.config.addonPath, "Data", "BridgeInbox.generated.lua");
  const acksPath = path.join(context.config.addonPath, "Data", "BridgeAcks.generated.lua");
  try {
    context.server.lootStatus = 404;
    const first = await context.sync();
    assert.equal(first.lootSync, "unsupported");
    assert.equal(first.telemetrySent, 1, "telemetry is still delivered");
    assert.equal(first.questSnapshotUpdated, true, "the quest inbox is still written");
    assert.ok(fs.existsSync(inboxPath));
    assert.match(fs.readFileSync(acksPath, "utf8"), /\["stats:character-rook"\] = "abc12345"/, "telemetry is still acknowledged to the add-on");
    assert.equal(fs.existsSync(context.lootPath), false);
    for (let pass = 0; pass < 5; pass += 1) assert.equal((await context.sync()).lootSync, "skipped");
    assert.equal(context.lootRequests().length, 1, "not asked again every minute");
    // Half an hour later the website has been updated.
    context.server.lootStatus = 200;
    assert.equal((await context.sync(31 * 60_000)).lootSync, "updated");
    const state = context.state();
    assert.equal(state.telemetryAckDigest.length, 16);
    assert.ok(Object.keys(state.sentTelemetryRevisions).length === 1, "telemetry bookkeeping is intact beside the loot state");
  } finally {
    context.cleanup();
  }
});

test("loot sync stays off for a configuration that does not ask for it", async () => {
  const context = setup({ lootSyncIntervalMs: 0 });
  try {
    const result = await context.sync();
    assert.equal(result.lootSync, "skipped");
    assert.equal(context.lootRequests().length, 0);
    assert.equal(fs.existsSync(context.lootPath), false);
  } finally {
    context.cleanup();
  }
});

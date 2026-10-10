# Guildweaver telemetry contract

Guildweaver's telemetry layer is intentionally generic. Holdfast is one consumer; the collector format does not encode Holdfast guild state, Discord membership, ranks, Rep, Marks, quests, or other guild-owned concepts.

## SavedVariables input

SavedVariables schema 4 adds:

`GuildweaverDB.sync.outbound.telemetry[streamKey]`

Each stream contains only its newest snapshot revision:

- `revision`
- `updatedAt`
- `fingerprint`
- `envelope`

This keeps SavedVariables bounded. Snapshot captures that have not materially changed do not create a new revision.

## Envelope schema 1

Every generic record uses:

- `schemaVersion`
- `eventType`
- `capturedAt`
- `gameBuild`
- `realm`
- `region`
- anonymous `installationId`
- anonymous `characterId` when character-scoped
- optional anonymous `guildId`
- `payload`

Character data arrives as one stream per data type: `character`, `stats`, `equipment`, `talents`, `professions`, `profession_snapshot` and `inventory_snapshot`. Older addons also sent a whole `character_snapshot` stream, which the bridge still forwards unchanged. The envelope is deliberately open to future event types such as `auction_seen`, `item_looted`, `craft_completed`, `recipe_learned`, `profession_snapshot`, `gathering_loot`, `vendor_seen`, and `boss_killed` without changing the bridge parser.

## Transport

Every record goes through the telemetry endpoint. The bridge no longer posts whole character snapshots to `/api/bridge/characters/snapshot`; the `sync.outbound.characters` mailbox older addons write is ignored.

Generic ingestion is enabled by configuring a full `telemetryEndpoint` URL. When configured, the bridge sends:

```json
{
  "streamKey": "character:character-...",
  "revision": 3,
  "envelope": {
    "schemaVersion": 1,
    "eventType": "character",
    "capturedAt": 1791242820,
    "gameBuild": {},
    "realm": "Realm",
    "region": "US",
    "installationId": "install-...",
    "characterId": "character-...",
    "guildId": null,
    "payload": {}
  }
}
```

Headers:

- `Authorization: Bearer <paired device credential>`
- `Content-Type: application/json`
- `Idempotency-Key: gw-<sha256>`

The idempotency key is stable for the same stream revision and content (it includes the payload fingerprint). A revision at or below the last one sent is skipped unless its content differs from what was sent: that means the addon's revision counter was reset (SavedVariables wiped, or a pruned stream recreated), and the record is sent so the website never freezes on the old content. The website accepts newer content at a reused revision. The bridge only records a telemetry revision as sent after a successful HTTP response. Network/server failures leave the record queued for the next polling cycle. A collector should also enforce idempotency server-side because reinstalling or moving a SavedVariables file can legitimately cause a client retry.

When `telemetryEndpoint` is absent, records remain deferred and unacknowledged. It defaults to `<holdfastUrl>/api/bridge/telemetry`.

## Shared fixture

`fixtures/telemetry/character_snapshot.v1.json` is the sample whole-snapshot payload older addons send. It includes equipment, an active talent tree, profession skill data, and a known recipe with reagents.

`fixtures/telemetry/profession_snapshot.v1.json` (and `fixtures/savedvariables/profession_snapshot.lua`, the same stream as the addon writes it) is the sample `profession_snapshot` stream: profession identity, skill values, and a recipe book with a crafted item, reagents, and a cooldown. The bridge passes it through unchanged like every other event type.

`fixtures/telemetry/inventory_snapshot.v1.json` (and `fixtures/savedvariables/inventory_snapshot.lua`) is the sample `inventory_snapshot` stream: carried containers with occupied slots (`bagId`, `slot`, `itemKey`, `count`), each distinct item described once in `items` (metadata, tooltip, stats, spell), per-`itemId` `totals`, and `money.copper`. An empty bag's `slots` is an empty Lua table, which the parser reads as `{}`; the bridge forwards it as-is and consumers treat it as no slots. Like every other stream, the bridge does not interpret it.

`fixtures/savedvariables/schema4.lua` is the matching bridge/parser fixture.

## Privacy exclusions

The collector does not intentionally collect:

- BattleTags
- account identifiers
- whispers
- chat logs
- private messages

Installation and character identifiers are generated locally and are not Battle.net account identifiers. Equipment is self-reported from the player's own character. The addon does not inspect-spam other players.

## WoW API limitations

World of Warcraft: Forever exposes a mixture of modern and legacy APIs. Collection is feature-detected and deliberately best-effort:

- modern talent data uses `C_ClassTalents` and `C_Traits` when available; legacy talent APIs are used as a fallback
- tree positions, visible edges, conditions, currency/point counts, definition ids, spell ids, and icons are omitted when the client does not expose them
- profession specialization metadata is collected only when `C_ProfSpecs`/trait config APIs are present
- full recipe catalogs are only available while the profession/tradeskill APIs expose them, normally after the player opens the relevant profession UI
- recipe collection never opens a profession UI automatically and previously captured recipes are retained between ordinary character snapshots
- some item metadata depends on the local item cache; item id/link and parsed link modifiers remain available even when richer cached metadata is temporarily missing

Missing APIs or partial data should reduce payload richness rather than crash the addon or invalidate the bridge record.

# Guildweaver telemetry contract

Guildweaver's telemetry layer is intentionally generic. Holdfast is one consumer; the collector format does not encode Holdfast guild state, Discord membership, ranks, Rep, Marks, quests, or other guild-owned concepts.

## SavedVariables input

SavedVariables schema 4 carries two generic outbound telemetry shapes.

### Latest-state streams

`GuildweaverDB.sync.outbound.telemetry[streamKey]` keeps only the newest revision for state such as characters, professions, and recipe catalogs.

Each stream contains:

- `revision`
- `updatedAt`
- `fingerprint`
- `envelope`

Current state stream families include:

- `character_snapshot:<characterId>`
- `profession_snapshot:<characterId>`
- `recipe_catalog_snapshot:<characterId>:<professionKey>`

### Ordered event queue

`GuildweaverDB.sync.outbound.events` is a separate bounded queue for observations that must not be overwritten by the next observation.

The queue contains:

- monotonic `nextSequence`
- cumulative `dropped`
- `items[eventId]`

Each item contains record schema 1, a stable event id, sequence, created time, and a generic telemetry envelope. The addon retains the newest 512 events and increments `dropped` if an offline backlog overflows.

The bridge sorts events by sequence and sends them through the same configured `telemetryEndpoint`. Each event is represented on the wire as a one-revision telemetry record with stream key `event:<eventId>`, which gives every observation the same stable idempotency mechanism as state telemetry.

The bridge stores only the highest contiguous sequence successfully delivered for each SavedVariables file. If sequence N fails, later sequences are not sent during that pass. This prevents a temporary network/server failure from allowing later observations to leapfrog a missing one.

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

The generic parser intentionally accepts new event types without a bridge release. State streams currently include `character_snapshot`, `profession_snapshot`, and `recipe_catalog_snapshot`; queued event families can include `auction_seen`, `item_looted`, `craft_completed`, `recipe_learned`, `gathering_loot`, `vendor_seen`, and `boss_killed`.

## Transport

The bridge continues to POST character snapshots to the existing paired website character endpoint for backward compatibility.

Generic ingestion is enabled by configuring a full `telemetryEndpoint` URL. State and queued-event records both use:

```json
{
  "streamKey": "character_snapshot:character-...",
  "revision": 3,
  "envelope": {
    "schemaVersion": 1,
    "eventType": "character_snapshot",
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

Queued events use `streamKey: event:<eventId>` and `revision: 1`.

Headers:

- `Authorization: Bearer <paired device credential>`
- `Content-Type: application/json`
- `Idempotency-Key: gw-<sha256>`

The idempotency key is stable for the same stream revision/event id. State revisions and event sequences are only acknowledged locally after a successful HTTP response. Network/server failures leave records eligible for the next polling cycle. The collector service should also enforce idempotency server-side because bridge state can be lost or a SavedVariables file can move.

When `telemetryEndpoint` is absent, generic state records and events remain deferred while the existing website character sync continues normally.

## Shared fixtures

`fixtures/telemetry/character_snapshot.v1.json` is the canonical rich character sample payload for website/collector development. It includes equipment, an active talent tree, profession skill data, and a known recipe with reagents.

`fixtures/telemetry/profession_snapshot.v1.json` verifies that sparse profession slots, skill/max-skill/modifier state, and recipe coverage metadata survive generic bridge normalization unchanged.

`fixtures/savedvariables/schema4.lua` covers state telemetry.

`fixtures/savedvariables/schema4-events.lua` covers ordered append-only observations, retry ordering, and contiguous sequence acknowledgement.

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
- profession state is enumerated by explicit return position so nil gaps in `GetProfessions()` do not hide later secondary professions
- full recipe catalogs are only available while the profession/tradeskill APIs expose them, normally after the player opens the relevant profession UI
- recipe collection never opens a profession UI automatically and previously captured recipes are retained between ordinary character snapshots
- some item metadata depends on the local item cache; item id/link and parsed link modifiers remain available even when richer cached metadata is temporarily missing

Missing APIs or partial data should reduce payload richness rather than crash the addon or invalidate the bridge record.

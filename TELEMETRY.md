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

The first event type is `character_snapshot`. The envelope is deliberately open to future event types such as `auction_seen`, `item_looted`, `craft_completed`, `recipe_learned`, `profession_snapshot`, `gathering_loot`, `vendor_seen`, and `boss_killed` without changing the bridge parser.

## Transport

Generic ingestion is enabled by configuring a full `telemetryEndpoint` URL. When configured, the bridge sends:

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

Headers:

- `Authorization: Bearer <collector-scoped telemetry credential>`
- `Content-Type: application/json`
- `Idempotency-Key: gw-<sha256>`

The collector credential is independent from Holdfast pairing and is stored in the bridge application-data directory as `telemetry-credentials.json` by default. It uses a separate schema so a future collector bootstrap/pairing flow can rotate or revoke telemetry access without changing Holdfast membership credentials.

For compatibility during the transition, a configured generic endpoint falls back to the existing Holdfast device token when no collector credential exists. New collector deployments should issue their own installation-scoped telemetry credential instead of relying on that fallback.

The idempotency key is stable for the same stream revision. The bridge only records a telemetry revision as sent after a successful HTTP response. Network/server/auth failures leave the record queued for the next polling cycle. A collector should also enforce idempotency server-side because reinstalling or moving a SavedVariables file can legitimately cause a client retry.

When `telemetryEndpoint` is absent, generic records remain deferred and unacknowledged.

## Holdfast as an optional consumer

Holdfast integration remains enabled by default for existing Guildweaver installations. In that mode the bridge continues to:

- pair with Holdfast
- send the backward-compatible character snapshot transport
- submit quest actions
- receive Holdfast-owned quest snapshots

A generic collector deployment can disable all Holdfast traffic:

```json
{
  "holdfastEnabled": false,
  "telemetryEndpoint": "https://collector.example/v1/telemetry"
}
```

In collector-only mode the bridge does not require Holdfast/Discord pairing and does not call Holdfast character or quest APIs. Addon installation, SavedVariables discovery, generic telemetry delivery, automatic addon updates, bridge self-updates, and Windows/macOS/Linux background behavior remain available.

This allows Holdfast to remain one optional consumer of Guildweaver rather than the identity or transport authority for the shared data platform.

## Collector credential file

The private telemetry credential file uses schema 1:

```json
{
  "schemaVersion": 1,
  "telemetryToken": "collector-issued-secret",
  "collectorId": "optional-collector-id",
  "installationId": "optional-installation-id",
  "issuedAt": "2026-10-06T04:00:00.000Z"
}
```

It is stored separately from Holdfast pairing credentials with restrictive file permissions where the platform supports them. The current bridge includes the read/write contract; automatic collector enrollment is intentionally left for the collector service slice.

## Shared fixture

`fixtures/telemetry/character_snapshot.v1.json` is the canonical sample payload for website/collector development. It includes equipment, an active talent tree, profession skill data, and a known recipe with reagents.

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

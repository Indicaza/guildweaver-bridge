# Guildweaver Bridge

Guildweaver Bridge is the local companion process between the Guildweaver World of Warcraft addon and a Guildweaver-compatible website.

The WoW addon never performs HTTP requests. It writes versioned outbound data to SavedVariables. The bridge reads those files, delivers new revisions to the website, receives website-owned state, and manages Guildweaver installation and updates.

## Normal user flow

Normal users do not install Node, Git, the addon, tokens, Discord IDs, or update commands.

### Windows

```text
Download GuildweaverBridge.zip
        ↓
Extract it
        ↓
Double-click “Install Guildweaver Bridge.cmd”
        ↓
Bridge copies itself to Local AppData
        ↓
Bridge finds WoW + installs Guildweaver
        ↓
Pair with Holdfast once in the browser
        ↓
Bridge starts silently with Windows
        ↓
Bridge + addon update themselves automatically
```

### macOS

Choose the package for the Mac:

- `GuildweaverBridge-macos-arm64.zip` — Apple Silicon (M-series)
- `GuildweaverBridge-macos-x64.zip` — Intel Mac

Then:

```text
Download + extract the matching ZIP
        ↓
Open “Install Guildweaver Bridge.command”
        ↓
Bridge copies itself to ~/Library/Application Support/Guildweaver
        ↓
Bridge finds WoW + installs Guildweaver
        ↓
Pair with Holdfast once in the browser
        ↓
LaunchAgent starts the Bridge at login
        ↓
Bridge + addon update themselves automatically
```

The current alpha packages are not yet Apple-notarized. Depending on Gatekeeper settings, the first launch may require using **Open** from Finder's context menu or approving the app in Privacy & Security. After installation, normal background operation does not require repeated approval.

### Linux

Choose the package for the machine:

- `GuildweaverBridge-linux-x64.zip` — normal Intel/AMD desktop Linux
- `GuildweaverBridge-linux-arm64.zip` — ARM64 Linux

Then:

```text
Download + extract the matching ZIP
        ↓
Run “Install Guildweaver Bridge.sh”
        ↓
Bridge copies itself to the per-user XDG state directory
        ↓
Bridge finds WoW in common Wine/Lutris/Bottles/Proton locations + installs Guildweaver
        ↓
Pair with Holdfast once in the browser
        ↓
XDG autostart launches the Bridge when the desktop session starts
        ↓
Bridge + addon update themselves automatically
```

The Linux package is self-contained and ships its own Node runtime. A source install still requires Node.js and Git.

After installation the downloaded archive can be deleted.

The device credential is bound by Holdfast to the Discord member who approved it. The bridge does not choose a member ID and cannot use its credential to sync characters into another member's profile.

## Automatic updates

Both layers use tested GitHub Release artifacts rather than raw source for normal users.

Channels:

- `edge` — automated builds from merged `main`
- `beta` — newest tagged alpha/beta/RC build
- `stable` — newest tagged stable build

The current alpha defaults to `edge` while Guildweaver is under active development.

### Addon

The bridge checks the Guildweaver release channel periodically. If the addon is missing, it installs it. If a newer build exists, it downloads the ZIP, verifies SHA-256, validates release metadata, stages the update, and replaces the addon directory.

A user never needs to download the addon separately.

### Bridge

Packaged Bridge installs live in a stable per-user application-data path and include their own Node runtime:

- Windows: `%LOCALAPPDATA%\Guildweaver\app`
- macOS: `~/Library/Application Support/Guildweaver/app`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/guildweaver/app`

The background Bridge checks its Bridge release channel periodically. When a newer build exists it downloads and verifies the platform-specific package, stages it beside the current install, exits cleanly, swaps versions outside the running process, and restarts through the OS startup integration.

Windows uses the per-user Run registry entry. macOS uses `launchd` with `~/Library/LaunchAgents/com.guildweaver.bridge.plist`. Linux uses the freedesktop/XDG autostart directory (`$XDG_CONFIG_HOME/autostart`, falling back to `~/.config/autostart`).

macOS unloads the LaunchAgent before replacing the running package so `KeepAlive` cannot race the swap. Linux waits for the running process to exit, swaps the staged package, verifies that the replacement starts and creates its instance lock, and rolls back to the previous package if startup fails.

## Developer checkout behavior

Development installs keep the existing git-friendly path.

If the addon is a git checkout/junction, the bridge only fast-forwards a clean `main` worktree to `origin/main`; dirty or feature branches are left untouched.

If the Bridge itself is running from a git checkout, it uses the same clean-`main`, fast-forward-only rule instead of packaged release replacement.

This lets developers keep the current repo/junction workflow while normal guild members never need Git.

## Data flow

```text
Guildweaver addon
    ↕ SavedVariables / generated inbox
Guildweaver Bridge
    ↕ paired device credential
Holdfast API
    ↕
Website / Discord
```

After delivering telemetry, the bridge writes `Data/BridgeAcks.generated.lua` into the addon folder: each delivered stream key with the fingerprint the server has. On its next login the addon drops those records from SavedVariables, so the save holds only undelivered data instead of growing to the outbound queue's cap. The file is written locally, without a network call, and only when the set changes.

### Loot inbox: wishlists and valuable-BoE watchlist

Every `lootSyncIntervalMs` (one minute by default) the bridge asks Holdfast for the account's character gear wishlists and a short list of valuable Bind-on-Equip items per auction house (`GET /api/bridge/loot/snapshot`), and writes them to `Data/BridgeLoot.generated.lua` in the addon folder. The addon uses that file to highlight wanted and valuable items in Need/Greed rolls. WoW reads it at login or `/reload`; nothing updates inside a running game.

The loot inbox is tracked on its own, apart from the quest inbox:

- Its change marker is a digest of its own content (`-- Guildweaver Bridge loot <digest>`), and its state lives under `loot` in the bridge state file. A wishlist edit reaches the addon whether or not a quest changed, and a quest change never rewrites the loot file.
- An unchanged snapshot costs one conditional request (`If-None-Match`) and no write. The same content delivered again is not rewritten.
- The answer is checked against the contract (schema 1) before anything is written. A malformed, oversized or unsupported answer, an answer older than the file, a server error or no network all leave the existing file exactly as it is: the addon keeps the last valid wishlist.
- The file is written beside the old one, read back, and moved over it in one step, so there is never a missing or half-written loot inbox.
- What is written is bounded whatever the website sends: 20 characters, 200 wishlist items each, 4 markets, 300 watchlist items each, short text. It stays well under 200 KB.
- If the file disappears (the addon was updated) or is not the one last written, the whole snapshot is fetched and written again.
- A website that does not have the endpoint yet answers 404; the bridge then asks again every 30 minutes instead of every minute.
- A failure here never stops quest sync, telemetry delivery or telemetry acknowledgements.

Each character in the file carries the addon's own ids for it (`aliases`), its name and realm, so the addon can tell which wishlist belongs to the character that is logged in.

The addon reports group rolls (`loot_roll`) and Encounter Journal loot lists (`loot_catalog_snapshot`) through the ordinary telemetry path below; the bridge forwards them unread like every other event.

WoW owns observed game facts such as character level, gear, professions, inventory, and game-side progress. Holdfast remains authoritative for guild-owned state such as assignments, Rep, Marks, rewards, ranks, billets, permissions, and notifications.

## Release packages

Every release publishes:

- `GuildweaverBridge.zip` — Windows x64
- `GuildweaverBridge.zip.sha256`
- `GuildweaverBridge-macos-x64.zip` — Intel Mac
- `GuildweaverBridge-macos-x64.zip.sha256`
- `GuildweaverBridge-macos-arm64.zip` — Apple Silicon Mac
- `GuildweaverBridge-macos-arm64.zip.sha256`
- `GuildweaverBridge-linux-x64.zip` — Linux x64
- `GuildweaverBridge-linux-x64.zip.sha256`
- `GuildweaverBridge-linux-arm64.zip` — Linux ARM64
- `GuildweaverBridge-linux-arm64.zip.sha256`
- `release.json`

Each package contains its own Node runtime plus the Bridge application. macOS and Linux release CI download the official Node runtime for each architecture and verify Node's published SHA-256 before packaging it.

## World of Warcraft discovery

Windows checks the normal Program Files locations and common WoW roots.

macOS checks:

- `/Applications/World of Warcraft`
- `~/Applications/World of Warcraft`
- mounted external volumes under `/Volumes/*/World of Warcraft`
- `/Volumes/*/Applications/World of Warcraft`

Linux checks common native launcher and compatibility-layer layouts, including:

- `$WINEPREFIX`
- `~/.wine`
- `~/Games` and common Lutris-style prefixes
- Bottles native and Flatpak data directories
- Steam Proton `compatdata/*/pfx` directories

Inside Wine/Proton prefixes, both `Program Files` and `Program Files (x86)` WoW locations are checked.

Discovery targets the live WoW Forever client (`_forever_`). Existing beta paths resolve to the sibling live installation.

For unusual installations on any OS, set `wowRoot` explicitly in the optional config.

## Source development

Requirements:

- Node.js 22+
- Git

```bash
git clone git@github.com:Indicaza/guildweaver-bridge.git
cd guildweaver-bridge
npm run background:install
```

Foreground development:

```bash
npm start
```

Validation:

```bash
npm run check
npm test
```

CI executes the Bridge syntax/tests on Linux, Windows, and macOS. Release CI additionally builds Windows x64, macOS Intel/Apple Silicon, and Linux x64/ARM64 packages.

## Background commands

Check a source/development install:

```bash
npm run background:status
```

Remove it:

```bash
npm run background:uninstall
```

The packaged installer performs background installation automatically.

## Optional advanced config

A config file is only needed for non-standard WoW installs, development websites, custom polling, or update channels.

```json
{
  "holdfastUrl": "https://holdfast-tddi.onrender.com",
  "wowRoot": "/Applications/World of Warcraft/_forever_",
  "pollIntervalMs": 3000,
  "lootSyncIntervalMs": 60000,
  "addonUpdateChannel": "edge",
  "bridgeUpdateChannel": "edge",
  "addonUpdateIntervalMs": 900000,
  "bridgeUpdateIntervalMs": 60000
}
```

Valid addon and bridge update channels are `edge`, `beta`, and `stable`. `lootSyncIntervalMs` (wishlists and the valuable-BoE watchlist) is at least 15000.

There are intentionally no member IDs or authentication secrets in the config.

## Local data

Guildweaver Bridge stores runtime data under the OS application-data directory:

- Windows: `%LOCALAPPDATA%\Guildweaver`
- macOS: `~/Library/Application Support/Guildweaver`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/guildweaver`

Important files/directories include:

- `app/` — installed self-contained Bridge runtime
- `bridge-credentials.json` — scoped device credential issued by Holdfast
- `bridge-state.json` — synchronization acknowledgements
- `bridge.lock` — single-instance guard
- `bridge.log` — background diagnostics
- Windows: `background.vbs`
- macOS: `background.sh` plus `~/Library/LaunchAgents/com.guildweaver.bridge.plist`
- Linux: `background.sh` plus `$XDG_CONFIG_HOME/autostart/guildweaver-bridge.desktop` (or `~/.config/autostart/guildweaver-bridge.desktop`)
- temporary staged update/restart files while updates are applied

Deleting the credential causes the next run to pair again.

## Security model

Pairing uses a short-lived one-time device code. Holdfast requires Discord authentication and explicit approval, then issues a random per-device credential and stores only its hash server-side.

Character and quest bridge APIs derive the member from that device credential. The bridge cannot select an arbitrary member ID.

Addon and packaged Bridge updates are accepted only after the downloaded artifact matches its published SHA-256 checksum and the staged release metadata matches the expected commit.

Developer self-update is restricted to clean `main` checkouts and fast-forward-only updates from `origin/main`.

## Farming session transport

The bridge forwards envelope-v1 `farming_session` events and gathering `context.farming` / map metadata unchanged. Farming checkpoints use a stable stream key, increasing revisions and payload `sequence`; successful delivery is acknowledged, offline failures are retried with the same idempotency key, and a newer checkpoint/final record is delivered once. No new endpoint, SavedVariables version, pairing permission or timing calculation is required in the bridge.

The contract fixture and integration tests cover measured duration, optional AFK evidence, zero/one coordinates, retry and final-checkpoint delivery. Timing classification and rate eligibility belong to the collector/website. Deploy the website consumer before rolling out the addon producer.

### Dungeon runs

`dungeon_run` events travel the same envelope-v1 event path, unread and unchanged. Each run has one stream key (`dungeon_run:<character>:<runId>`); an open checkpoint written at /reload or logout and the final run are newer revisions of it with a higher payload `sequence`. Retries reuse the idempotency key, and the website, not the bridge, keeps a finished run from being overwritten. Mob loot and gathering events inside a run carry `context.dungeonRun.runId`, also forwarded as is. `fixtures/telemetry/dungeon_run.v1.json` is paired with the website fixture.

### Auction House scans

`auction_scan` events (what a player's client showed of the auction house) use the same envelope-v1 event path, unread and unchanged, including the nested `[unitPrice, quantity, listings]` price arrays. Each scan chunk has its own stream key (`auction_scan:<character>:<scanId>`); retries reuse the idempotency key, and the website tells a retry (same scan id) from the same results seen again later (a new observation that confirms the old one). `fixtures/telemetry/auction_scan.v1.json` (a modern commodity search) and `fixtures/telemetry/auction_scan.page.v1.json` (a page of the classic browse frame, with item names) are shared with the website tests. The bridge never contacts Blizzard's auction API; that runs on the website server.

### Mob loot and public game definitions

The bridge carries `mob_loot` event revisions and `game_item_definition` state records through the existing envelope-v1 path without rewriting source GUID allocations, coordinates, locale, visibility, or dungeon/difficulty context. `fixtures/telemetry/mob_loot.v1.json` and `game_item_definition.v1.json` are paired with the website fixtures. Contract tests exercise SavedVariables parsing, failed-upload retry, stable idempotency keys, and later corpse revisions.

A base game definition is separate from an equipped/bag item definition. Public filtering happens at the website's dedicated fact projection; the bridge never makes character uploads public. SavedVariables remains schema 4, and no endpoint configuration change is required. Searching the catalog inside the addon is a later downstream-cache feature; the addon does not make HTTP requests.


## Manual archive commands (site administrators)

Archive access is disabled for every device by default. Pair the intended computer normally, then enable that specific device under Archive devices in the website Sync Console (/admin/guildweaver). Enabling access does not start a job or transfer any data.

```sh
node src/cli.js archive status
node src/cli.js archive pull --dataset market-monthly --market MARKET_KEY --out /existing/archive/batch-001.json.gz
```

The status command lists authorization, available dataset names and market keys. A pull requests at most 200 rows, verifies the server SHA-256 checksum and writes a compressed, versioned JSON batch to an explicitly chosen, previously nonexistent file. Pass the printed nextCursor to --cursor and use a different output filename to continue. market-current contains live price summaries; market-monthly contains finalized monthly aggregates. Current data can change between pages; this is not a consistent full backup. No background archive polling, automatic deletion, retention acknowledgement, or production database replacement is performed. Do not use these exports as the sole disaster recovery backup.

## Guildweaver command center

Source checkout: `npm link` registers `gw` using the package bin entry. The packaged installer writes a launcher into the application's per-user data directory under `bin`; add that directory to your PATH once if necessary. Existing installed bridges can run `node src/gw.js install-cli` with their installed runtime. No shell profile or system PATH is changed automatically.

```sh
gw
gw help
gw status --json
gw logs
gw dev logs character
gw dev logs errors --no-follow
gw dev logs network --level error --lines 100
gw archive status
gw open
```
The dev log viewer supports follow mode, rotation detection and JSON output; domain filtering on legacy text logs is heuristic. Debug records are not fabricated. It does not download data or alter synchronization. Archive data transfer still requires explicit authorization and an output destination.

## Manual agent operations

After the updated background bridge has started, `gw sync` requests a bounded full sync pass from the running agent, rather than creating a competing process. Use `gw sync character`, `gw sync ah`, `gw sync telemetry` (all upload telemetry, no inbox pulls), `gw sync professions wishlist`, or `gw sync quests`. It only reads game data already saved to disk. A busy bridge returns an error rather than racing a scheduled job. Scoped uploads preserve other domains' checkpoint and acknowledgment state; the next normal full pass writes the complete acknowledgement mailbox.

`gw update [addon|bridge]` uses the existing verified update mechanisms. Bridge replacement reports restart-scheduled until the new process confirms its commit. The addon notification says installed and requests a WoW reload, not that the new code has loaded. `gw notify test`, `gw notify off`, and `gw notify on` control desktop notifications. macOS uses osascript, Linux notify-send, and Windows PowerShell/WinRT toasts; desktop notification delivery depends on permissions, desktop session and platform availability. Failure is logged, not fatal. The Windows application identity and packaged desktop notifications still need live verification.

`gw dev on` enables structured per-upload debug events in the rotating bridge log, including correlation ID, revision, latency and HTTP outcome; `gw dev off` disables them. `gw dev logs ah` follows a domain, `gw dev trace ID` finds recorded local stages, and `--json` emits structured rows. This is local transport tracing, not yet full addon-to-database distributed tracing. No raw telemetry payloads are logged by the new trace events.

### Queued archive exports (requires updated website)

```powershell
gw archive status
gw archive pull --dataset market-monthly --market MARKET_KEY --dir D:\GuildweaverData\market-monthly
gw archive verify --dir D:\GuildweaverData\market-monthly
```

The server admits one read-only worker at a time, returns queue tickets, and rejects excess demand with Retry-After. The CLI retries with jitter and a finite wait budget. It verifies each 200-row maximum page before publishing a new gzip file. Use the same command/directory to resume from verified cursor-chain files. Ctrl+C cancels a queued ticket when possible and leaves complete local pages alone. The destination filesystem must support hard links for atomic no-overwrite publication. An archive is a cursor traversal, not a consistent database snapshot; market-current may change between pages. No server data is deleted, no automatic archive is enabled, and only current summaries and finalized monthly history are available.

### Held Auction House transfer

Pause both Auction House ingestion sources and save the settings in the website admin panel. Authorize this PC for archive access and start an archive hold. A hold prevents scheduled market rollups and pruning while the existing history is transferred. It is not a full database backup. Use an empty directory on the intended local drive:

```powershell
gw archive status
gw archive pull-all --dir "D:\GuildweaverData\archive\transfer-01"
gw archive verify-all --dir "D:\GuildweaverData\archive\transfer-01"
```

The transfer includes current summaries and every retained hourly, daily, weekly and monthly series row for every advertised market, including non-final months. It writes bounded SHA-256-verified gzip batches and a local transfer plan. Repeat the same pull-all command after interruption; a changed hold or market list requires a different destination. The hold must stay active until the final server status check and local verification succeed. A final verified.json receipt binds the plan to the verified page chains. This is not authorization to delete production data: raw observations, ladders, provider records and non-market state are not included. A separate restore-tested database backup is required before destructive cleanup.

Bulk transfers can be requested explicitly after the website advertises bulk protocol 1:

```powershell
gw archive pull-all --mode bulk --dir "D:\GuildweaverData\archive\transfer-01"
```

Stop the previous transfer before resuming. Use the same directory and hold. Existing pages and checksums remain valid; the new bridge accepts mixed page sizes. The website keeps the same single-worker queue, timeouts, rate limits and aggregate queued-result reservation budget. Bulk pages are bounded to 4,000 rows and 1 MiB serialized result. If production load increases, stop and resume with `--mode safe` (or omit mode). This is a throughput optimization, not a complete database backup.

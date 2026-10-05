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

The background Bridge checks its Bridge release channel periodically. When a newer build exists it downloads and verifies the platform-specific package, stages it beside the current install, exits cleanly, swaps versions outside the running process, and restarts through the OS startup manager.

Windows uses the per-user Run registry entry. macOS uses `launchd` with `~/Library/LaunchAgents/com.guildweaver.bridge.plist`.

The macOS updater explicitly unloads the LaunchAgent before replacing the running package so `KeepAlive` cannot race the swap. If replacement or re-bootstrap fails, it restores the previous package.

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

WoW owns observed game facts such as character level, gear, professions, inventory, and game-side progress. Holdfast remains authoritative for guild-owned state such as assignments, Rep, Marks, rewards, ranks, billets, permissions, and notifications.

## Release packages

Every release publishes:

- `GuildweaverBridge.zip` — Windows x64
- `GuildweaverBridge.zip.sha256`
- `GuildweaverBridge-macos-x64.zip` — Intel Mac
- `GuildweaverBridge-macos-x64.zip.sha256`
- `GuildweaverBridge-macos-arm64.zip` — Apple Silicon Mac
- `GuildweaverBridge-macos-arm64.zip.sha256`
- `release.json`

Each package contains its own Node runtime plus the Bridge application. Mac release CI downloads the official Node runtime for each architecture and verifies Node's published SHA-256 before packaging it.

## World of Warcraft discovery

Windows checks the normal Program Files locations and common WoW roots.

macOS checks:

- `/Applications/World of Warcraft`
- `~/Applications/World of Warcraft`
- mounted external volumes under `/Volumes/*/World of Warcraft`
- `/Volumes/*/Applications/World of Warcraft`

The standard WoW variants (`_classic_beta_`, `_classic_`, `_anniversary_`, `_retail_`, PTR/beta variants) are supported by the same discovery logic.

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

CI executes the Bridge syntax/tests on Linux, Windows, and macOS. Release CI additionally builds Windows, Intel Mac, and Apple Silicon Mac packages.

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
  "wowRoot": "/Applications/World of Warcraft/_classic_beta_",
  "pollIntervalMs": 3000,
  "addonUpdateChannel": "edge",
  "bridgeUpdateChannel": "edge",
  "addonUpdateIntervalMs": 900000,
  "bridgeUpdateIntervalMs": 60000
}
```

Valid addon and bridge update channels are `edge`, `beta`, and `stable`.

There are intentionally no member IDs or authentication secrets in the config.

## Local data

Guildweaver Bridge stores runtime data under the OS application-data directory:

- Windows: `%LOCALAPPDATA%\Guildweaver`
- macOS: `~/Library/Application Support/Guildweaver`

Important files/directories include:

- `app/` — installed self-contained Bridge runtime
- `bridge-credentials.json` — scoped device credential issued by Holdfast
- `bridge-state.json` — synchronization acknowledgements
- `bridge.lock` — single-instance guard
- `bridge.log` — background diagnostics
- Windows: `background.vbs`
- macOS: `background.sh` plus `~/Library/LaunchAgents/com.guildweaver.bridge.plist`
- temporary staged update/restart files while updates are applied

Deleting the credential causes the next run to pair again.

## Security model

Pairing uses a short-lived one-time device code. Holdfast requires Discord authentication and explicit approval, then issues a random per-device credential and stores only its hash server-side.

Character and quest bridge APIs derive the member from that device credential. The bridge cannot select an arbitrary member ID.

Addon and packaged Bridge updates are accepted only after the downloaded artifact matches its published SHA-256 checksum and the staged release metadata matches the expected commit.

Developer self-update is restricted to clean `main` checkouts and fast-forward-only updates from `origin/main`.

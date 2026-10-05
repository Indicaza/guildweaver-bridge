# Guildweaver Bridge

Guildweaver Bridge is the local companion process between the Guildweaver World of Warcraft addon and a Guildweaver-compatible website.

The WoW addon never performs HTTP requests. It writes versioned outbound data to SavedVariables. The bridge reads those files, delivers new revisions to the website, receives website-owned state, and manages Guildweaver installation and updates.

## Normal user flow

Normal users do not install Node, Git, the addon, tokens, Discord IDs, or update commands.

```text
Download GuildweaverBridge.zip
        ↓
Extract it
        ↓
Double-click “Install Guildweaver Bridge.cmd”
        ↓
Bridge copies itself to Local AppData
        ↓
Bridge finds WoW automatically
        ↓
Bridge installs Guildweaver automatically
        ↓
Browser opens Holdfast once
        ↓
Sign in with Discord if needed
        ↓
Click “Connect Guildweaver”
        ↓
Bridge starts silently with Windows
        ↓
Bridge + addon update themselves automatically
```

After installation the downloaded ZIP can be deleted.

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

Packaged Bridge installs live under `%LOCALAPPDATA%\Guildweaver\app` and include their own Node runtime. The background Bridge checks its Bridge release channel periodically.

When a newer build exists it:

1. downloads the new Bridge package,
2. verifies the published SHA-256 checksum,
3. validates the staged package and commit metadata,
4. stages it beside the current install,
5. exits cleanly,
6. lets a tiny Windows handoff script swap the package,
7. relaunches the background Bridge.

The background startup entry points at the stable AppData installation path, so users do not need to reinstall after updates.

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

## Packaged Windows release

Every Bridge release contains:

```text
GuildweaverBridge/
├── node.exe
├── Install Guildweaver Bridge.cmd
└── app/
    ├── package.json
    ├── release.json
    └── src/
```

The package has no external runtime dependency. The release pipeline smoke-runs the bundled runtime and publishes:

- `GuildweaverBridge.zip`
- `GuildweaverBridge.zip.sha256`
- `release.json`

## Source development

Requirements:

- Node.js 22+
- Git

```powershell
git clone git@github.com:Indicaza/guildweaver-bridge.git
cd guildweaver-bridge
npm run background:install
```

Foreground development:

```powershell
npm start
```

Validation:

```powershell
npm run check
npm test
```

## Background commands

Check a source/development install:

```powershell
npm run background:status
```

Remove it:

```powershell
npm run background:uninstall
```

The packaged installer performs background installation automatically.

## Optional advanced config

A config file is only needed for non-standard WoW installs, development websites, custom polling, or update channels.

```json
{
  "holdfastUrl": "https://holdfast-tddi.onrender.com",
  "wowRoot": "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_",
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

Guildweaver Bridge stores runtime data under the OS application-data directory. On Windows this is `%LOCALAPPDATA%\Guildweaver`.

Important files/directories include:

- `app/` — installed self-contained Bridge runtime
- `bridge-credentials.json` — scoped device credential issued by Holdfast
- `bridge-state.json` — synchronization acknowledgements
- `bridge.lock` — single-instance guard
- `bridge.log` — background diagnostics
- `background.vbs` — stable hidden Windows startup launcher
- temporary staged update/restart files while updates are applied

Deleting the credential causes the next run to pair again.

## Security model

Pairing uses a short-lived one-time device code. Holdfast requires Discord authentication and explicit approval, then issues a random per-device credential and stores only its hash server-side.

Character and quest bridge APIs derive the member from that device credential. The bridge cannot select an arbitrary member ID.

Addon and packaged Bridge updates are accepted only after the downloaded artifact matches its published SHA-256 checksum and the staged release metadata matches the expected commit.

Developer self-update is restricted to clean `main` checkouts and fast-forward-only updates from `origin/main`.

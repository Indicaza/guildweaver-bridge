# Guildweaver Bridge

Guildweaver Bridge is the local companion process between the Guildweaver World of Warcraft addon and a Guildweaver-compatible website.

The WoW addon never performs HTTP requests. It writes versioned outbound data to SavedVariables. The bridge reads those files, delivers new revisions to the website, and keeps the Guildweaver addon current.

## User flow

Normal users do not configure tokens, Discord IDs, addon paths, or update commands.

```text
Install Guildweaver Bridge
        ↓
Run background install once
        ↓
Bridge finds WoW automatically
        ↓
Bridge installs/updates Guildweaver
        ↓
Browser opens Holdfast once
        ↓
Sign in with Discord if needed
        ↓
Click “Connect Guildweaver”
        ↓
Bridge starts silently with Windows
        ↓
Bridge + addon updates + character sync happen automatically
```

The device credential is bound by Holdfast to the Discord member who approved it. The bridge does not choose a member ID and cannot use its credential to sync characters into another member's profile.

## Data flow

```text
Guildweaver addon
    -> WTF/Account/.../SavedVariables/Guildweaver.lua
    -> Guildweaver Bridge
    -> paired device credential
    -> Holdfast API
    -> member profile + snapshot history
```

## Addon updates

Guildweaver releases are published as tested GitHub Release artifacts. The bridge checks the configured channel periodically and installs only packages whose SHA-256 checksum matches the published release checksum.

Channels:

- `edge` — automated builds from merged `main`
- `beta` — the newest tagged alpha/beta/RC build
- `stable` — the newest tagged stable build

The current alpha defaults to `edge` while Guildweaver is under active development.

Updates are staged and validated before the installed addon directory is replaced. The packaged addon contains `release.json` so the bridge can compare the installed commit and compatibility metadata with the release.

### Developer checkout behavior

If `Interface\\AddOns\\Guildweaver` resolves to a git checkout or junction, the bridge does not replace it with a ZIP. Instead it:

1. checks whether the worktree is clean,
2. runs `git fetch origin main`,
3. fast-forwards to `origin/main` only,
4. leaves a dirty checkout or non-main branch untouched.

This keeps the local junction development flow safe while normal users never need Git.

## Bridge self-update

Source-based background installs also keep the bridge itself current. Once per minute the hidden bridge checks its own git checkout.

A bridge self-update only runs when:

- the checkout is clean,
- the checked-out branch is `main`,
- `origin/main` is a fast-forward from the current commit.

After a successful update, the running process schedules a hidden delayed relaunch, releases its single-instance lock, exits, and comes back on the new commit. Dirty worktrees and feature branches are never modified.

This is the development self-update path. A future packaged Windows build will use release artifacts instead of requiring Git.

## Requirements

- Node.js 22+ while developing from source
- A Guildweaver-compatible website with device pairing enabled

The packaged desktop build will remove the Node.js and Git requirements for normal users.

## Recommended Windows setup

Clone the repository once, then install the bridge as a per-user background process:

```powershell
git clone git@github.com:Indicaza/guildweaver-bridge.git
cd guildweaver-bridge
npm run background:install
```

On first install the bridge pairs with Holdfast if needed, registers a hidden launcher under the current Windows user's startup entries, and starts immediately.

After that there is no terminal to keep open. The bridge starts automatically when the user signs into Windows and keeps only one watcher process alive.

Check it:

```powershell
npm run background:status
```

Remove it:

```powershell
npm run background:uninstall
```

No administrator privileges are intended to be required because startup registration is scoped to the current Windows user.

## Foreground development

To run it visibly instead:

```powershell
npm start
```

If the background bridge is already running, foreground watch mode exits rather than starting a duplicate watcher.

No `guildweaver-bridge.json` file is required for a standard installation.

## Optional advanced config

A config file is only needed for non-standard WoW installs, development websites, custom polling, or update channels.

```json
{
  "holdfastUrl": "https://holdfast-tddi.onrender.com",
  "wowRoot": "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_",
  "pollIntervalMs": 3000,
  "addonUpdateChannel": "edge",
  "addonUpdateIntervalMs": 900000,
  "bridgeUpdateIntervalMs": 60000
}
```

Valid addon update channels are `edge`, `beta`, and `stable`.

There are intentionally no member IDs or authentication secrets in the config.

## Sync once

WoW flushes SavedVariables on logout and `/reload`. To check the addon update channel, pair if needed, and perform one deterministic sync pass:

```powershell
npm run once
```

## Watch behavior

The background process scans the local Guildweaver SavedVariables file and sends only revisions that Holdfast has not already accepted. When nothing has changed, it does not send sync requests.

Addon update checks and bridge self-update checks run on their own slower intervals and are independent of the SavedVariables polling interval.

WoW currently flushes SavedVariables on logout and `/reload`, so those events remain the handoff point from the addon to the companion bridge.

## Pair only

```powershell
npm run pair
```

This is mainly useful for setup/debugging. Normal sync and background installation pair automatically when needed.

## Local data

Guildweaver Bridge stores local runtime data in the OS application-data directory:

- `bridge-credentials.json` — scoped device credential issued by Holdfast
- `bridge-state.json` — acknowledgment state for revisions already delivered
- `bridge.lock` — single-instance guard for the watcher
- `bridge.log` — background diagnostics, rotated at approximately 1 MB
- `background.vbs` — hidden Windows launcher registered for the current user
- temporary restart/update files while an update is being applied

Deleting the credential causes the next run to pair again.

## Development

```powershell
npm run check
npm test
```

The bridge intentionally has no runtime npm dependencies in the current alpha.

## Security model

Pairing uses a short-lived one-time device code. The website requires the user to authenticate with Discord and explicitly approve the PC. Holdfast then issues a random per-device bearer credential and stores only its hash server-side.

Character ingest derives the member from that device credential. A bridge request cannot select an arbitrary Discord/member ID.

Addon updates are accepted only after the downloaded ZIP matches the SHA-256 checksum published with the release and the staged package contains matching release metadata.

Bridge source self-update is restricted to a clean `main` checkout and uses only a fast-forward merge from `origin/main`.

The device credential is scoped to Guildweaver bridge APIs; Holdfast rank, permissions, Rep, Marks, and other authoritative guild state remain website-owned.

## Next

1. Package the bridge as a Windows executable so normal users do not need Node or Git.
2. Add website device management for viewing/revoking connected PCs.
3. Use the same paired bridge for website-to-addon quest and notification sync.

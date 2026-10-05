# Guildweaver Bridge

Guildweaver Bridge is the local companion process between the Guildweaver World of Warcraft addon and a Guildweaver-compatible website.

The WoW addon never performs HTTP requests. It writes versioned outbound data to SavedVariables. The bridge reads those files and delivers new revisions to the website.

## User flow

Normal users do not configure tokens, Discord IDs, or file paths.

```text
Install Guildweaver + Guildweaver Bridge
        ↓
Run background install once
        ↓
Bridge finds WoW automatically
        ↓
Browser opens Holdfast once
        ↓
Sign in with Discord if needed
        ↓
Click “Connect Guildweaver”
        ↓
Bridge receives a scoped device credential
        ↓
Bridge starts silently with Windows
        ↓
Character sync happens automatically
```

The device credential is bound by Holdfast to the Discord member who approved it. The bridge does not choose a member ID and cannot use its credential to sync characters into another member's profile.

## Alpha data flow

```text
Guildweaver addon
    -> WTF/Account/.../SavedVariables/Guildweaver.lua
    -> Guildweaver Bridge
    -> paired device credential
    -> POST /api/bridge/characters/snapshot
    -> Holdfast member profile + character snapshot history
```

## Requirements

- Node.js 22+ while developing from source
- Guildweaver addon installed and enabled
- A Guildweaver-compatible website with device pairing enabled

The packaged desktop build will remove the Node.js requirement for normal users.

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

A config file is only needed for non-standard WoW installs, development websites, or custom polling behavior.

```json
{
  "holdfastUrl": "https://holdfast-tddi.onrender.com",
  "wowRoot": "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_",
  "pollIntervalMs": 3000
}
```

Then run with the default config filename:

```powershell
npm start
```

or an explicit file:

```powershell
node src/cli.js watch --config path\to\config.json
```

There are intentionally no member IDs or authentication secrets in the config.

## Sync once

WoW flushes SavedVariables on logout and `/reload`. To pair if needed and perform one deterministic sync pass:

```powershell
npm run once
```

## Watch behavior

The background process scans the local Guildweaver SavedVariables file and sends only revisions that Holdfast has not already accepted. When nothing has changed, it does not send network requests.

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

The device credential is scoped to Guildweaver bridge APIs; Holdfast rank, permissions, Rep, Marks, and other authoritative guild state remain website-owned.

## Next

1. Package the bridge as a Windows executable so normal users do not need Node or Git.
2. Add update handling.
3. Add a website device-management page for viewing/revoking connected PCs.
4. Use the same paired bridge for website-to-addon quest and notification sync.

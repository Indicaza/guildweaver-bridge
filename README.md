# Guildweaver Bridge

Guildweaver Bridge is the local companion process between the Guildweaver World of Warcraft addon and a Guildweaver-compatible website.

The WoW addon never performs HTTP requests. It writes versioned outbound data to SavedVariables. The bridge reads those files and delivers new revisions to the website.

## User flow

Normal users do not configure tokens, Discord IDs, or file paths.

```text
Install Guildweaver + Guildweaver Bridge
        ↓
Run the bridge
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
Character sync runs automatically from then on
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

## Run from source

```powershell
git clone git@github.com:Indicaza/guildweaver-bridge.git
cd guildweaver-bridge
npm start
```

On first run the bridge opens the Holdfast pairing page in your browser. Approve the connection and return to the game. The credential is stored in the operating system's local application-data directory, not in the repository.

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

## Watch mode

```powershell
npm start
```

Watch mode polls SavedVariables and sends only revisions that Holdfast has not already accepted.

## Pair only

```powershell
npm run pair
```

This is mainly useful for setup/debugging. Normal `npm start` and `npm run once` pair automatically when needed.

## Local data

Guildweaver Bridge stores two local files in the OS application-data directory:

- `bridge-credentials.json` — the scoped device credential issued by Holdfast
- `bridge-state.json` — acknowledgment state for revisions already delivered

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

1. Package the bridge as a Windows executable/tray app.
2. Add start-with-Windows and update handling.
3. Add a website device-management page for viewing/revoking connected PCs.
4. Use the same paired bridge for website-to-addon quest and notification sync.

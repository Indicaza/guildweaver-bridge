# Guildweaver Bridge

Guildweaver Bridge is the local companion process between the Guildweaver World of Warcraft addon and a Guildweaver-compatible website.

The WoW addon never performs HTTP requests. It writes versioned outbound data to SavedVariables. The bridge reads those files and delivers new revisions to the website.

## Alpha data flow

```text
Guildweaver addon
    -> WTF/Account/.../SavedVariables/Guildweaver.lua
    -> Guildweaver Bridge
    -> POST /api/bridge/characters/snapshot
    -> Holdfast member profile + character snapshot history
```

## Requirements

- Node.js 22+
- Guildweaver addon installed and enabled
- A Guildweaver-compatible website with character ingest enabled

## Local setup

Clone the repository and create a local config from the example:

```powershell
git clone git@github.com:Indicaza/guildweaver-bridge.git
cd guildweaver-bridge
Copy-Item guildweaver-bridge.example.json guildweaver-bridge.json
```

Edit `guildweaver-bridge.json` with the website URL, your member ID, the bridge token, and optionally the WoW install root.

For the WoW Forever beta on a default Windows install:

```json
{
  "holdfastUrl": "https://holdfast-tddi.onrender.com",
  "memberId": "YOUR_DISCORD_MEMBER_ID",
  "bridgeToken": "YOUR_GUILDWEAVER_BRIDGE_TOKEN",
  "wowRoot": "C:\\Program Files (x86)\\World of Warcraft\\_classic_beta_",
  "pollIntervalMs": 3000
}
```

The real config and local acknowledgment state are gitignored.

## Sync once

WoW flushes SavedVariables on logout and `/reload`. After Guildweaver has captured a character, flush the data and run:

```powershell
npm run once
```

The bridge discovers `Guildweaver.lua`, parses it without executing Lua, compares outbound revisions with its local acknowledgment state, and POSTs only unsent revisions.

## Watch mode

```powershell
npm start
```

Watch mode polls the SavedVariables files and sends new revisions after WoW flushes them.

## Development

```powershell
npm run check
npm test
```

The bridge intentionally has no runtime npm dependencies in the first alpha.

## Current authentication model

The current Holdfast alpha endpoint uses a guild-level bridge token plus a configured member ID. This is suitable for proving the local pipeline but is not the intended public distribution model.

Before Guildweaver is distributed broadly, this will be replaced by device/member pairing so each bridge credential is scoped to one website member and can be individually revoked.

## Next

1. Prove character sync end to end against Holdfast.
2. Replace alpha shared-token auth with pairing/device credentials.
3. Package the bridge as an easy Windows executable/tray app.
4. Add website-to-addon inbound sync for quests and notifications.

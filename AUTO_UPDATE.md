# Guildweaver Addon Updates

Guildweaver Bridge manages the Guildweaver addon installation.

## Normal installations

The bridge checks the configured release channel, downloads the published ZIP and SHA-256 checksum from deterministic GitHub Release URLs, validates the staged package, and replaces the installed addon directory only after verification succeeds.

The staged addon is created beside the live addon directory so the final directory swap stays on the same filesystem even when WoW is installed on another drive.

The addon release channel is checked every minute while the bridge is running. The bridge also watches for WoW to transition from not running to running and immediately checks both the bridge and addon release channels at that point. If the bridge itself updates, it restarts itself and performs the addon freshness check again on startup before normal SavedVariables syncing resumes.

## Developer installations

If the addon path resolves to a git checkout or junction, the bridge never replaces it with a release ZIP. Automatic git updates run only when the checkout is on `main` and the worktree is clean. The bridge then runs `git fetch origin main` followed by a fast-forward-only merge.

A dirty checkout or any non-`main` branch is left untouched.

## Compatibility

Release metadata includes a bridge protocol version. The bridge rejects addon releases that require a newer bridge protocol than it supports.

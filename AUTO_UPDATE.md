# Guildweaver Addon Updates

Guildweaver Bridge manages the Guildweaver addon installation.

## Normal installations

The bridge checks the configured release channel, downloads the published ZIP and SHA-256 checksum, validates the staged package, and replaces the installed addon directory only after verification succeeds.

## Developer installations

If the addon path resolves to a git checkout or junction, the bridge never replaces it with a release ZIP. A clean checkout is updated with `git fetch origin main` followed by a fast-forward-only merge. A dirty checkout is left untouched.

## Compatibility

Release metadata includes a bridge protocol version. The bridge rejects addon releases that require a newer bridge protocol than it supports.

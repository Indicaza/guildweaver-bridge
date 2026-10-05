import fs from "node:fs";
import path from "node:path";

import { findSavedVariablesFiles } from "./discovery.js";
import { outboundCharacters, parseSavedVariables } from "./savedVariables.js";

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    return { sentRevisions: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      sentRevisions:
        parsed?.sentRevisions && typeof parsed.sentRevisions === "object"
          ? parsed.sentRevisions
          : {},
    };
  } catch {
    return { sentRevisions: {} };
  }
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, statePath);
}

function stateKey(filePath, characterKey) {
  return `${path.resolve(filePath)}::${characterKey}`;
}

async function postSnapshot(config, envelope, fetchImpl) {
  if (!config.deviceToken) {
    throw new Error("Guildweaver Bridge is not paired with Holdfast");
  }

  const response = await fetchImpl(
    `${config.holdfastUrl}/api/bridge/characters/snapshot`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.deviceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        revision: Number(envelope.revision),
        snapshot: envelope.payload,
      }),
    },
  );

  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail = body?.error || text || `HTTP ${response.status}`;
    throw new Error(`Holdfast rejected snapshot: ${detail}`);
  }

  return body;
}

export async function syncOnce(
  config,
  { fetchImpl = fetch, log = console.log } = {},
) {
  const files = findSavedVariablesFiles(config);
  const state = readState(config.statePath);
  let discovered = 0;
  let sent = 0;
  let skipped = 0;

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    const database = parseSavedVariables(source);
    const outbound = outboundCharacters(database);

    for (const [characterKey, envelope] of Object.entries(outbound)) {
      discovered += 1;
      const revision = Number(envelope?.revision);
      const snapshot = envelope?.payload;

      if (!Number.isFinite(revision) || revision < 1 || !snapshot) {
        log(`Skipping malformed outbound snapshot ${characterKey}`);
        skipped += 1;
        continue;
      }

      const key = stateKey(filePath, characterKey);
      const previousRevision = Number(state.sentRevisions[key]) || 0;

      if (previousRevision >= revision) {
        skipped += 1;
        continue;
      }

      const result = await postSnapshot(config, envelope, fetchImpl);
      state.sentRevisions[key] = revision;
      writeState(config.statePath, state);
      sent += 1;

      const name = snapshot.name || characterKey;
      const level = snapshot.level ? ` level ${snapshot.level}` : "";
      log(
        `Synced ${name}${level} revision ${revision}` +
          (result?.status ? ` (${result.status})` : ""),
      );
    }
  }

  return { files: files.length, discovered, sent, skipped };
}

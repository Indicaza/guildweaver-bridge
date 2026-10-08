import fs from "node:fs";
import path from "node:path";

import { writeBridgeInbox } from "./bridgeInbox.js";
import { findSavedVariablesFiles } from "./discovery.js";
import {
  assertSupportedSavedVariablesSchema,
  outboundCharacters,
  outboundTelemetry,
  parseSavedVariables,
} from "./savedVariables.js";
import {
  normalizeTelemetryRecord,
  telemetryIdempotencyKey,
  telemetryTransportBody,
} from "./telemetry.js";

function emptyState() {
  return {
    sentRevisions: {},
    sentTelemetryRevisions: {},
    sentTelemetryFingerprints: {},
    questActions: {},
    lastQuestSyncAt: 0,
    lastServerReconcileAt: 0,
  };
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    return emptyState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      sentRevisions:
        parsed?.sentRevisions && typeof parsed.sentRevisions === "object"
          ? parsed.sentRevisions
          : {},
      sentTelemetryRevisions:
        parsed?.sentTelemetryRevisions &&
        typeof parsed.sentTelemetryRevisions === "object"
          ? parsed.sentTelemetryRevisions
          : {},
      sentTelemetryFingerprints:
        parsed?.sentTelemetryFingerprints &&
        typeof parsed.sentTelemetryFingerprints === "object"
          ? parsed.sentTelemetryFingerprints
          : {},
      questActions:
        parsed?.questActions && typeof parsed.questActions === "object"
          ? parsed.questActions
          : {},
      lastQuestSyncAt: Number(parsed?.lastQuestSyncAt) || 0,
      lastServerReconcileAt: Number(parsed?.lastServerReconcileAt) || 0,
    };
  } catch {
    return emptyState();
  }
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, statePath);
}

function stateKey(filePath, recordKey) {
  return `${path.resolve(filePath)}::${recordKey}`;
}

function outboundQuestActions(database) {
  const actions = database?.sync?.outbound?.questActions;
  if (!actions || typeof actions !== "object" || Array.isArray(actions)) return {};
  return actions;
}

function validQuestAction(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    ["join", "leave"].includes(value.action) &&
    typeof value.questId === "string" &&
    typeof value.objectiveId === "string"
  );
}

function invalidDeviceToken(error) {
  return String(error?.message || "").includes("invalid_device_token");
}

async function responseBody(response) {
  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  return { text, body };
}

async function postSnapshot(config, streamKey, envelope, fetchImpl) {
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
        streamKey,
        revision: Number(envelope.revision),
        snapshot: envelope.payload,
      }),
    },
  );

  const { text, body } = await responseBody(response);

  if (!response.ok) {
    const detail = body?.error || text || `HTTP ${response.status}`;
    throw new Error(`Holdfast rejected snapshot: ${detail}`);
  }

  return body;
}

async function postTelemetry(config, record, fetchImpl) {
  if (!config.telemetryEndpoint) {
    return null;
  }

  if (!config.deviceToken) {
    throw new Error("Generic telemetry transport requires a paired device credential");
  }

  const response = await fetchImpl(config.telemetryEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deviceToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": telemetryIdempotencyKey(record),
    },
    body: JSON.stringify(telemetryTransportBody(record)),
  });
  const { text, body } = await responseBody(response);

  if (!response.ok) {
    const detail = body?.error || text || `HTTP ${response.status}`;
    throw new Error(`Telemetry ingestion rejected record: ${detail}`);
  }

  return body;
}

async function postSyncState(config, manifest, fetchImpl) {
  if (!config.deviceToken) {
    throw new Error("Guildweaver Bridge is not paired with Holdfast");
  }

  const response = await fetchImpl(`${config.holdfastUrl}/api/bridge/sync-state`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deviceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(manifest),
  });
  const { text, body } = await responseBody(response);

  // Safe rolling deployment: old website versions simply leave the local cache
  // behavior in place until the server-side reconciliation endpoint is live.
  if (response.status === 404) return { supported: false };

  if (!response.ok) {
    const detail = body?.error || text || `HTTP ${response.status}`;
    throw new Error(`Holdfast sync-state failed: ${detail}`);
  }

  if (
    Number(body?.schemaVersion) !== 1 ||
    !Array.isArray(body?.characters) ||
    !Array.isArray(body?.telemetry)
  ) {
    throw new Error("Holdfast returned an invalid sync-state response");
  }

  return { supported: true, ...body };
}

async function postQuestActions(config, actions, fetchImpl) {
  const response = await fetchImpl(`${config.holdfastUrl}/api/bridge/quests/actions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deviceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ actions }),
  });
  const { text, body } = await responseBody(response);

  if (!response.ok) {
    const detail = body?.error || text || `HTTP ${response.status}`;
    throw new Error(`Holdfast rejected quest actions: ${detail}`);
  }

  return Array.isArray(body?.results) ? body.results : [];
}

async function getQuestSnapshot(config, fetchImpl) {
  const response = await fetchImpl(`${config.holdfastUrl}/api/bridge/quests/snapshot`, {
    headers: { Authorization: `Bearer ${config.deviceToken}` },
  });
  const { text, body } = await responseBody(response);

  if (!response.ok) {
    const detail = body?.error || text || `HTTP ${response.status}`;
    throw new Error(`Holdfast quest sync failed: ${detail}`);
  }

  if (
    !body ||
    Number(body.schemaVersion) !== 1 ||
    !Array.isArray(body.items) ||
    !Number.isInteger(Number(body.revision))
  ) {
    throw new Error("Holdfast returned an invalid quest snapshot");
  }

  return body;
}

function reconciliationManifest(loaded, includeTelemetry) {
  const characters = new Map();
  const telemetry = new Map();

  for (const { database } of loaded) {
    for (const [streamKey, envelope] of Object.entries(outboundCharacters(database))) {
      const revision = Number(envelope?.revision);
      if (!Number.isInteger(revision) || revision < 1 || !envelope?.payload) continue;
      characters.set(streamKey, Math.max(characters.get(streamKey) || 0, revision));
    }

    if (!includeTelemetry) continue;
    for (const [streamKey, rawRecord] of Object.entries(outboundTelemetry(database))) {
      try {
        const record = normalizeTelemetryRecord(streamKey, rawRecord);
        telemetry.set(
          record.streamKey,
          Math.max(telemetry.get(record.streamKey) || 0, record.revision),
        );
      } catch {
        // The normal telemetry pass reports malformed records with useful context.
      }
    }
  }

  const entries = (map) => [...map.entries()].map(([streamKey, revision]) => ({
    streamKey,
    revision,
  }));

  return { characters: entries(characters), telemetry: entries(telemetry) };
}

function revisionMap(values) {
  return new Map(
    (Array.isArray(values) ? values : [])
      .map((value) => [String(value?.streamKey || ""), Number(value?.serverRevision) || 0])
      .filter(([streamKey]) => streamKey),
  );
}

export async function syncOnce(
  config,
  { fetchImpl = fetch, log = console.log, now = Date.now } = {},
) {
  const files = findSavedVariablesFiles(config);
  const state = readState(config.statePath);
  const loaded = [];
  const pendingQuestActions = new Map();
  const currentQuestActionIds = new Set();
  let discovered = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let skippedFiles = 0;
  let telemetryDiscovered = 0;
  let telemetrySent = 0;
  let telemetrySkipped = 0;
  let telemetryDeferred = 0;
  let telemetryFailed = 0;

  for (const filePath of files) {
    try {
      const source = fs.readFileSync(filePath, "utf8");
      const database = parseSavedVariables(source);
      assertSupportedSavedVariablesSchema(database);
      loaded.push({ filePath, database });
    } catch (error) {
      skippedFiles += 1;
      log(`Skipping unreadable Guildweaver SavedVariables ${filePath}: ${error.message}`);
    }
  }

  let serverAuthority = false;
  let serverCharacterRevisions = new Map();
  let serverTelemetryRevisions = new Map();
  const reconcileIntervalMs = Number(config.reconcileIntervalMs);
  const scanTimestamp = now();
  const reconcileDue =
    Number.isFinite(reconcileIntervalMs) &&
    reconcileIntervalMs > 0 &&
    scanTimestamp - state.lastServerReconcileAt >= reconcileIntervalMs;

  if (reconcileDue) {
    // Record the attempt before network I/O so a transient server problem does
    // not turn the one-second SavedVariables poll into a request storm.
    state.lastServerReconcileAt = scanTimestamp;
    writeState(config.statePath, state);

    try {
      const reconciliation = await postSyncState(
        config,
        reconciliationManifest(loaded, Boolean(config.telemetryEndpoint)),
        fetchImpl,
      );
      serverAuthority = reconciliation.supported === true;
      if (serverAuthority) {
        serverCharacterRevisions = revisionMap(reconciliation.characters);
        serverTelemetryRevisions = revisionMap(reconciliation.telemetry);
      }
    } catch (error) {
      if (invalidDeviceToken(error)) throw error;
      log(`Guildweaver server reconciliation deferred: ${error.message}`);
    }
  }

  for (const { filePath, database } of loaded) {
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
      const serverRevision = serverAuthority
        ? Number(serverCharacterRevisions.get(characterKey) || 0)
        : null;
      const serverHasRevision = serverAuthority && serverRevision >= revision;
      const serverMissingRevision = serverAuthority && serverRevision < revision;

      if (serverHasRevision) {
        state.sentRevisions[key] = Math.max(previousRevision, revision);
        writeState(config.statePath, state);
        skipped += 1;
        continue;
      }

      if (!serverMissingRevision && previousRevision >= revision) {
        skipped += 1;
        continue;
      }

      try {
        const result = await postSnapshot(config, characterKey, envelope, fetchImpl);
        state.sentRevisions[key] = revision;
        writeState(config.statePath, state);
        sent += 1;

        const name = snapshot.name || characterKey;
        const level = snapshot.level ? ` level ${snapshot.level}` : "";
        log(
          `Synced ${name}${level} revision ${revision}` +
            (result?.status ? ` (${result.status})` : ""),
        );
      } catch (error) {
        if (invalidDeviceToken(error)) throw error;
        failed += 1;
        log(`Snapshot ${characterKey} remains queued: ${error.message}`);
      }
    }

    for (const [streamKey, rawRecord] of Object.entries(outboundTelemetry(database))) {
      telemetryDiscovered += 1;
      let record;

      try {
        record = normalizeTelemetryRecord(streamKey, rawRecord);
      } catch (error) {
        telemetrySkipped += 1;
        log(`Skipping malformed telemetry ${streamKey}: ${error.message}`);
        continue;
      }

      const key = stateKey(filePath, `telemetry:${record.streamKey}`);
      const previousRevision = Number(state.sentTelemetryRevisions[key]) || 0;
      const serverRevision = serverAuthority
        ? Number(serverTelemetryRevisions.get(record.streamKey) || 0)
        : null;
      const serverHasRevision = serverAuthority && serverRevision >= record.revision;
      const serverMissingRevision = serverAuthority && serverRevision < record.revision;

      if (serverHasRevision) {
        state.sentTelemetryRevisions[key] = Math.max(previousRevision, record.revision);
        if (record.fingerprint) state.sentTelemetryFingerprints[key] = record.fingerprint;
        writeState(config.statePath, state);
        telemetrySkipped += 1;
        continue;
      }

      if (!serverMissingRevision && previousRevision >= record.revision) {
        telemetrySkipped += 1;
        continue;
      }

      if (
        !serverMissingRevision &&
        record.kind === "state" &&
        record.fingerprint &&
        state.sentTelemetryFingerprints[key] === record.fingerprint
      ) {
        state.sentTelemetryRevisions[key] = record.revision;
        writeState(config.statePath, state);
        telemetrySkipped += 1;
        log(`Skipped unchanged telemetry ${record.streamKey} revision ${record.revision}.`);
        continue;
      }

      if (!config.telemetryEndpoint) {
        telemetryDeferred += 1;
        continue;
      }

      try {
        const result = await postTelemetry(config, record, fetchImpl);
        state.sentTelemetryRevisions[key] = record.revision;
        if (record.fingerprint) {
          state.sentTelemetryFingerprints[key] = record.fingerprint;
        }
        writeState(config.statePath, state);
        telemetrySent += 1;
        log(
          `Synced telemetry ${record.envelope.eventType} revision ${record.revision}` +
            (result?.status ? ` (${result.status})` : ""),
        );
      } catch (error) {
        if (invalidDeviceToken(error)) throw error;
        telemetryFailed += 1;
        log(`Telemetry ${record.streamKey} remains queued: ${error.message}`);
      }
    }

    for (const [actionId, action] of Object.entries(outboundQuestActions(database))) {
      currentQuestActionIds.add(actionId);
      if (state.questActions[actionId]) continue;

      if (!validQuestAction(action)) {
        state.questActions[actionId] = {
          status: "rejected",
          error: "invalid_local_quest_action",
          updatedAt: now(),
        };
        continue;
      }

      pendingQuestActions.set(actionId, action);
    }
  }

  let questActionsSent = 0;

  if (pendingQuestActions.size > 0) {
    const results = await postQuestActions(
      config,
      [...pendingQuestActions.values()],
      fetchImpl,
    );

    for (const result of results) {
      const actionId = String(result?.id || "");
      if (!pendingQuestActions.has(actionId)) continue;
      if (!["applied", "already-applied", "rejected"].includes(result.status)) continue;

      state.questActions[actionId] = {
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
        updatedAt: now(),
      };
      questActionsSent += 1;
      log(
        result.status === "rejected"
          ? `Quest action ${actionId} rejected: ${result.error || "unknown"}`
          : `Quest action ${actionId} ${result.status}.`,
      );
    }

    writeState(config.statePath, state);
  }

  for (const actionId of Object.keys(state.questActions)) {
    if (!currentQuestActionIds.has(actionId)) {
      delete state.questActions[actionId];
    }
  }

  const timestamp = now();
  const questSyncDue =
    questActionsSent > 0 ||
    timestamp - state.lastQuestSyncAt >= config.questSyncIntervalMs;
  let questSnapshotUpdated = false;

  if (questSyncDue) {
    const snapshot = await getQuestSnapshot(config, fetchImpl);
    const acknowledgedQuestActions = [...currentQuestActionIds].filter(
      (actionId) => state.questActions[actionId],
    );
    const inbox = writeBridgeInbox(config, {
      quests: snapshot,
      acknowledgedQuestActions,
    });

    state.lastQuestSyncAt = timestamp;
    writeState(config.statePath, state);
    questSnapshotUpdated = inbox.changed;

    if (inbox.changed) {
      log(
        `Quest inbox updated to Holdfast revision ${snapshot.revision}; /reload to apply in WoW.`,
      );
    }
  }

  return {
    files: files.length,
    skippedFiles,
    discovered,
    sent,
    failed,
    skipped,
    telemetryDiscovered,
    telemetrySent,
    telemetrySkipped,
    telemetryDeferred,
    telemetryFailed,
    questActionsDiscovered: currentQuestActionIds.size,
    questActionsSent,
    questSnapshotUpdated,
    serverReconciled: serverAuthority,
  };
}

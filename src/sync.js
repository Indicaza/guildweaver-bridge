import fs from "node:fs";
import path from "node:path";

import { writeBridgeInbox } from "./bridgeInbox.js";
import { findSavedVariablesFiles } from "./discovery.js";
import {
  assertSupportedSavedVariablesSchema,
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
    sentTelemetryRevisions: {},
    sentTelemetryFingerprints: {},
    rejectedTelemetry: {},
    questActions: {},
    lastQuestSyncAt: 0,
  };
}

// syncOnce runs every pollIntervalMs (1s by default), and parsing a large
// SavedVariables file costs hundreds of milliseconds. A file whose mtime and
// size match the last fully settled pass has nothing new to send, so it is
// skipped until it changes or a reconcile is due. Entries remember the quest
// action ids the file carried so skipping it does not prune their state.
const settledFiles = new Map();

function fileSignature(stat) {
  return `${stat.mtimeMs}:${stat.size}`;
}

// 4xx means the server will refuse this exact content again. 401 is a device
// credential problem, 408 and 429 are retry-later signals; everything else
// waits for the addon to produce different content.
function permanentRejection(status) {
  return status >= 400 && status < 500 && ![401, 408, 429].includes(status);
}

class TelemetryRejectedError extends Error {
  constructor(status, detail) {
    super(`Telemetry ingestion rejected record: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

// Reconcile exists to repair website state for live character data. Catalog
// streams (item, game item and talent tree definitions) and streams without a
// character are resent whenever their fingerprint changes anyway, so
// replaying hundreds of them every interval only adds load.
function replayOnReconcile(record) {
  return (
    record.kind === "state" &&
    Boolean(record.envelope.characterId) &&
    !record.envelope.eventType.endsWith("_definition")
  );
}

// A revision at or below the last one sent normally means "already sent".
// When its content differs from what was sent, the addon's counter was reset
// (SavedVariables wiped, or a pruned stream recreated at revision 1), and
// skipping it would freeze that stream on the website until the counter
// caught up again.
function revisionReset(fingerprint, sentFingerprint) {
  return Boolean(fingerprint && sentFingerprint && fingerprint !== sentFingerprint);
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    return emptyState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
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
      rejectedTelemetry:
        parsed?.rejectedTelemetry && typeof parsed.rejectedTelemetry === "object"
          ? parsed.rejectedTelemetry
          : {},
      questActions:
        parsed?.questActions && typeof parsed.questActions === "object"
          ? parsed.questActions
          : {},
      lastQuestSyncAt: Number(parsed?.lastQuestSyncAt) || 0,
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
    throw new TelemetryRejectedError(response.status, detail);
  }

  return body;
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

export async function syncOnce(
  config,
  {
    fetchImpl = fetch,
    log = console.log,
    now = Date.now,
    reconcileState = false,
    fileCache = settledFiles,
  } = {},
) {
  const files = findSavedVariablesFiles(config);
  const state = readState(config.statePath);
  let stateDirty = false;
  const flushState = () => {
    if (!stateDirty) return;
    writeState(config.statePath, state);
    stateDirty = false;
  };
  const settledThisPass = new Map();
  const pendingQuestActions = new Map();
  const currentQuestActionIds = new Set();
  let skippedFiles = 0;
  let telemetryDiscovered = 0;
  let telemetrySent = 0;
  let telemetrySkipped = 0;
  let telemetryDeferred = 0;
  let telemetryFailed = 0;
  let telemetryRejected = 0;
  let unchangedFiles = 0;

  try {
    for (const filePath of files) {
      const cacheKey = `${path.resolve(config.statePath)}::${path.resolve(filePath)}`;
      let signature = null;
      try {
        signature = fileSignature(fs.statSync(filePath));
      } catch {
        signature = null;
      }

      const settled = fileCache.get(cacheKey);
      if (!reconcileState && signature && settled?.signature === signature) {
        unchangedFiles += 1;
        telemetryDiscovered += settled.telemetryCount;
        telemetrySkipped += settled.telemetryCount;
        for (const actionId of settled.questActionIds) currentQuestActionIds.add(actionId);
        continue;
      }
      fileCache.delete(cacheKey);

      let database;
      let fileOutstanding = false;
      const fileQuestActionIds = [];

      try {
        const source = fs.readFileSync(filePath, "utf8");
        database = parseSavedVariables(source);
        assertSupportedSavedVariablesSchema(database);
      } catch (error) {
        skippedFiles += 1;
        log(`Skipping unreadable Guildweaver SavedVariables ${filePath}: ${error.message}`);
        continue;
      }

      // Character data arrives as one telemetry stream per data type. Older
      // addons also kept whole snapshots in sync.outbound.characters for the
      // retired /api/bridge/characters/snapshot endpoint; those are ignored.
      const telemetryPrefix = stateKey(filePath, "telemetry:");
      const currentTelemetryKeys = new Set();

      for (const [streamKey, rawRecord] of Object.entries(outboundTelemetry(database))) {
        telemetryDiscovered += 1;
        currentTelemetryKeys.add(`${telemetryPrefix}${streamKey.trim()}`);
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
        const forceStateReplay = reconcileState && replayOnReconcile(record);
        const rejection = state.rejectedTelemetry[key];

        if (rejection && rejection.fingerprint !== record.fingerprint) {
          delete state.rejectedTelemetry[key];
          stateDirty = true;
        } else if (rejection && !reconcileState) {
          // Retried only on reconcile passes, so a server-side fix eventually
          // gets the record through without hammering the endpoint every poll.
          telemetrySkipped += 1;
          continue;
        }

        if (
          !forceStateReplay &&
          previousRevision >= record.revision &&
          !(record.kind === "state" && revisionReset(record.fingerprint, state.sentTelemetryFingerprints[key]))
        ) {
          telemetrySkipped += 1;
          continue;
        }

        if (
          !forceStateReplay &&
          record.kind === "state" &&
          record.fingerprint &&
          state.sentTelemetryFingerprints[key] === record.fingerprint
        ) {
          state.sentTelemetryRevisions[key] = record.revision;
          stateDirty = true;
          telemetrySkipped += 1;
          log(`Skipped unchanged telemetry ${record.streamKey} revision ${record.revision}.`);
          continue;
        }

        if (!config.telemetryEndpoint) {
          telemetryDeferred += 1;
          fileOutstanding = true;
          continue;
        }

        try {
          const result = await postTelemetry(config, record, fetchImpl);
          state.sentTelemetryRevisions[key] = record.revision;
          if (record.fingerprint) {
            state.sentTelemetryFingerprints[key] = record.fingerprint;
          }
          if (state.rejectedTelemetry[key]) delete state.rejectedTelemetry[key];
          stateDirty = true;
          telemetrySent += 1;
          log(
            `Synced telemetry ${record.envelope.eventType} revision ${record.revision}` +
              (result?.status ? ` (${result.status})` : ""),
          );
        } catch (error) {
          if (invalidDeviceToken(error)) throw error;
          telemetryFailed += 1;

          if (error instanceof TelemetryRejectedError && permanentRejection(error.status)) {
            telemetryRejected += 1;
            if (!rejection) {
              log(
                `Telemetry ${record.streamKey} revision ${record.revision} rejected ` +
                  `(HTTP ${error.status}): ${error.detail}; holding it until its content changes.`,
              );
            }
            state.rejectedTelemetry[key] = {
              fingerprint: record.fingerprint,
              revision: record.revision,
              status: error.status,
              error: String(error.detail).slice(0, 500),
              rejectedAt: rejection?.rejectedAt ?? now(),
            };
            stateDirty = true;
            continue;
          }

          fileOutstanding = true;
          log(`Telemetry ${record.streamKey} remains queued: ${error.message}`);
        }
      }

      // Streams the addon has dropped (pruned events, removed characters) no
      // longer need dedupe bookkeeping; without this the state file only grows.
      for (const store of [
        state.sentTelemetryRevisions,
        state.sentTelemetryFingerprints,
        state.rejectedTelemetry,
      ]) {
        for (const key of Object.keys(store)) {
          if (key.startsWith(telemetryPrefix) && !currentTelemetryKeys.has(key)) {
            delete store[key];
            stateDirty = true;
          }
        }
      }

      for (const [actionId, action] of Object.entries(outboundQuestActions(database))) {
        currentQuestActionIds.add(actionId);
        fileQuestActionIds.push(actionId);
        if (state.questActions[actionId]) continue;

        if (!validQuestAction(action)) {
          state.questActions[actionId] = {
            status: "rejected",
            error: "invalid_local_quest_action",
            updatedAt: now(),
          };
          stateDirty = true;
          continue;
        }

        pendingQuestActions.set(actionId, action);
      }

      flushState();
      if (signature && !fileOutstanding) {
        settledThisPass.set(cacheKey, {
          signature,
          questActionIds: fileQuestActionIds,
          telemetryCount: currentTelemetryKeys.size,
        });
      }
    }
  } finally {
    // A thrown pass (revoked device) still keeps what was already acknowledged.
    flushState();
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
      stateDirty = true;
    }
  }
  flushState();

  // Only files with nothing left to send (every quest action answered, no
  // queued telemetry) may be skipped by later polls.
  for (const [cacheKey, entry] of settledThisPass) {
    if (entry.questActionIds.every((actionId) => state.questActions[actionId])) {
      fileCache.set(cacheKey, entry);
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
    telemetryDiscovered,
    telemetrySent,
    telemetrySkipped,
    telemetryDeferred,
    telemetryFailed,
    telemetryRejected,
    unchangedFiles,
    questActionsDiscovered: currentQuestActionIds.size,
    questActionsSent,
    questSnapshotUpdated,
    reconciledState: Boolean(reconcileState),
  };
}

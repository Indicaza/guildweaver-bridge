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
    questActions: {},
    lastQuestSyncAt: 0,
  };
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
    throw new Error(`Telemetry ingestion rejected record: ${detail}`);
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
  } = {},
) {
  const files = findSavedVariablesFiles(config);
  const state = readState(config.statePath);
  const pendingQuestActions = new Map();
  const currentQuestActionIds = new Set();
  let skippedFiles = 0;
  let telemetryDiscovered = 0;
  let telemetrySent = 0;
  let telemetrySkipped = 0;
  let telemetryDeferred = 0;
  let telemetryFailed = 0;

  for (const filePath of files) {
    let database;

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
      const forceStateReplay = reconcileState && record.kind === "state";

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
    telemetryDiscovered,
    telemetrySent,
    telemetrySkipped,
    telemetryDeferred,
    telemetryFailed,
    questActionsDiscovered: currentQuestActionIds.size,
    questActionsSent,
    questSnapshotUpdated,
    reconciledState: Boolean(reconcileState),
  };
}

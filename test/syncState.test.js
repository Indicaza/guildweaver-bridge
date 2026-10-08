import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { invalidateOutboundDeliveryCache } from "../src/syncState.js";

test("clears only outbound delivery acknowledgements so current SavedVariables replay", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-sync-state-"));
  const statePath = path.join(directory, "bridge-state.json");

  fs.writeFileSync(
    statePath,
    `${JSON.stringify({
      sentRevisions: { "file::rook": 8 },
      sentTelemetryRevisions: { "file::telemetry:talents": 4 },
      sentTelemetryFingerprints: { "file::telemetry:talents": "deadbeef" },
      questActions: { action1: { status: "applied", updatedAt: 123 } },
      lastQuestSyncAt: 456,
    })}\n`,
    "utf8",
  );

  try {
    assert.equal(invalidateOutboundDeliveryCache(statePath), true);
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));

    assert.deepEqual(state.sentRevisions, {});
    assert.deepEqual(state.sentTelemetryRevisions, {});
    assert.deepEqual(state.sentTelemetryFingerprints, {});
    assert.deepEqual(state.questActions, {
      action1: { status: "applied", updatedAt: 123 },
    });
    assert.equal(state.lastQuestSyncAt, 456);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("missing or malformed state does not prevent bridge startup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-sync-state-"));
  const statePath = path.join(directory, "bridge-state.json");

  try {
    assert.equal(invalidateOutboundDeliveryCache(statePath), false);
    fs.writeFileSync(statePath, "{broken", "utf8");
    assert.equal(invalidateOutboundDeliveryCache(statePath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

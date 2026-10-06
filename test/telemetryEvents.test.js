import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseSavedVariables } from "../src/savedVariables.js";
import { syncOnce } from "../src/sync.js";
import { outboundTelemetryEvents } from "../src/telemetryEvents.js";

function fixtureSource() {
  return fs.readFileSync(
    new URL("../fixtures/savedvariables/schema4-events.lua", import.meta.url),
    "utf8",
  );
}

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver events "));
  const savedVariablesPath = path.join(directory, "Guildweaver.lua");
  const statePath = path.join(directory, "state", "bridge-state.json");
  fs.writeFileSync(savedVariablesPath, fixtureSource(), "utf8");

  return {
    directory,
    config: {
      holdfastUrl: "https://holdfast.example",
      telemetryEndpoint: "https://collector.example/v1/telemetry",
      deviceToken: "gwd_secret",
      savedVariablesPath,
      wowRoot: null,
      pollIntervalMs: 3000,
      questSyncIntervalMs: Number.MAX_SAFE_INTEGER,
      statePath,
    },
  };
}

function ok(body = { status: "accepted" }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("normalizes queued events in sequence order", () => {
  const database = parseSavedVariables(fixtureSource());
  const queue = outboundTelemetryEvents(database);

  assert.equal(queue.nextSequence, 3);
  assert.equal(queue.dropped, 0);
  assert.deepEqual(queue.items.map((event) => event.sequence), [1, 2, 3]);
  assert.deepEqual(
    queue.items.map((event) => event.record.envelope.eventType),
    ["loot_observation", "craft_completed", "recipe_learned"],
  );
  assert.equal(queue.items[0].record.streamKey, "event:install-fixture:character-fixture:1");
  assert.equal(queue.items[0].record.envelope.payload.location.mapId, 56);
  assert.equal(queue.items[0].record.envelope.payload.items[0].itemId, 765);
  assert.equal(queue.items[0].record.envelope.payload.items[0].sources[0].objectId, 1617);
});

test("drains queued events once and tracks the highest contiguous sequence", async () => {
  const { directory, config } = setup();
  const bodies = [];

  try {
    const fetchImpl = async (url, options) => {
      assert.equal(url, config.telemetryEndpoint);
      bodies.push(JSON.parse(options.body));
      assert.match(options.headers["Idempotency-Key"], /^gw-[a-f0-9]{64}$/);
      return ok();
    };

    const first = await syncOnce(config, { fetchImpl, log: () => {} });
    const second = await syncOnce(config, { fetchImpl, log: () => {} });

    assert.equal(first.telemetryEventsDiscovered, 3);
    assert.equal(first.telemetryEventsSent, 3);
    assert.equal(first.telemetryEventsFailed, 0);
    assert.equal(second.telemetryEventsSent, 0);
    assert.equal(second.telemetryEventsSkipped, 3);
    assert.deepEqual(bodies.map((body) => body.envelope.eventType), [
      "loot_observation",
      "craft_completed",
      "recipe_learned",
    ]);
    assert.equal(bodies[0].envelope.payload.items[0].itemId, 765);
    assert.equal(bodies[0].envelope.payload.items[0].quantity, 3);

    const state = JSON.parse(fs.readFileSync(config.statePath, "utf8"));
    assert.equal(Object.values(state.sentTelemetryEventSequences)[0], 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("stops at a failed event so later sequences cannot leapfrog it", async () => {
  const { directory, config } = setup();
  let sequenceTwoOnline = false;
  const attempted = [];

  try {
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      const eventType = body.envelope.eventType;
      attempted.push(eventType);

      if (eventType === "craft_completed" && !sequenceTwoOnline) {
        return new Response(JSON.stringify({ error: "offline" }), { status: 503 });
      }

      return ok();
    };

    const first = await syncOnce(config, { fetchImpl, log: () => {} });
    assert.equal(first.telemetryEventsSent, 1);
    assert.equal(first.telemetryEventsFailed, 1);
    assert.deepEqual(attempted, ["loot_observation", "craft_completed"]);

    let state = JSON.parse(fs.readFileSync(config.statePath, "utf8"));
    assert.equal(Object.values(state.sentTelemetryEventSequences)[0], 1);

    sequenceTwoOnline = true;
    const second = await syncOnce(config, { fetchImpl, log: () => {} });
    assert.equal(second.telemetryEventsSent, 2);
    assert.deepEqual(attempted, [
      "loot_observation",
      "craft_completed",
      "craft_completed",
      "recipe_learned",
    ]);

    state = JSON.parse(fs.readFileSync(config.statePath, "utf8"));
    assert.equal(Object.values(state.sentTelemetryEventSequences)[0], 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

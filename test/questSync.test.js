import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bridgeInboxSource } from "../src/bridgeInbox.js";
import { syncOnce } from "../src/sync.js";

function questSavedVariables() {
  return `GuildweaverDB = {
    ["sync"] = {
      ["outbound"] = {
        ["characters"] = {},
        ["questActions"] = {
          ["action-1"] = {
            ["id"] = "action-1",
            ["action"] = "join",
            ["questId"] = "quest-1",
            ["objectiveId"] = "objective-1",
          },
        },
      },
    },
  }`;
}

function questSnapshot() {
  return {
    schemaVersion: 1,
    revision: 9,
    updatedAt: "2026-10-05T20:00:00.000Z",
    synced: true,
    items: [
      {
        id: "quest-1",
        campaign: "Guild Quests",
        title: "Supply Run",
        description: "Bring linen",
        priority: "High",
        status: "active",
        rewards: [{ type: "rep", label: "Rep", amount: 50 }],
        objectives: [
          {
            id: "objective-1",
            title: "Gather Linen",
            description: "Bring cloth",
            priority: "High",
            completed: false,
            assignment: {
              status: "assigned",
              me: true,
              members: ["Tester"],
            },
          },
        ],
      },
    ],
  };
}

test("quest actions are delivered once and authoritative state is written to the addon inbox", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "guildweaver-quest-sync-"));
  const addonPath = path.join(directory, "Guildweaver");
  const savedVariablesPath = path.join(directory, "Guildweaver.lua");
  const statePath = path.join(directory, "state.json");
  fs.mkdirSync(path.join(addonPath, "Data"), { recursive: true });
  fs.writeFileSync(savedVariablesPath, questSavedVariables(), "utf8");

  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });

    if (url.endsWith("/api/bridge/quests/actions")) {
      return new Response(
        JSON.stringify({
          status: "ok",
          results: [{ id: "action-1", status: "applied" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.endsWith("/api/bridge/quests/snapshot")) {
      return new Response(JSON.stringify(questSnapshot()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const config = {
    holdfastUrl: "https://holdfast.example",
    deviceToken: "gwd_secret",
    savedVariablesPath,
    addonPath,
    wowRoot: null,
    pollIntervalMs: 3000,
    questSyncIntervalMs: 15000,
    statePath,
  };

  try {
    const first = await syncOnce(config, {
      fetchImpl,
      log: () => {},
      now: () => 100000,
    });
    const second = await syncOnce(config, {
      fetchImpl,
      log: () => {},
      now: () => 100001,
    });

    assert.equal(first.questActionsSent, 1);
    assert.equal(first.questSnapshotUpdated, true);
    assert.equal(second.questActionsSent, 0);
    assert.equal(requests.length, 2);

    const actionRequest = requests.find((item) =>
      item.url.endsWith("/api/bridge/quests/actions"),
    );
    const actionBody = JSON.parse(actionRequest.options.body);
    assert.equal(actionBody.actions[0].id, "action-1");
    assert.equal(actionBody.actions[0].action, "join");

    const inboxPath = path.join(addonPath, "Data", "BridgeInbox.generated.lua");
    const inbox = fs.readFileSync(inboxPath, "utf8");
    assert.match(inbox, /Guildweaver Bridge inbox 9:action-1/);
    assert.match(inbox, /GW\.BridgeInbox/);
    assert.match(inbox, /action-1/);
    assert.match(inbox, /Supply Run/);

    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.questActions["action-1"].status, "applied");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("bridge inbox serializer escapes website text as Lua data", () => {
  const source = bridgeInboxSource({
    acknowledgedQuestActions: [],
    quests: {
      schemaVersion: 1,
      revision: 1,
      synced: true,
      items: [
        {
          id: "quest-1",
          title: 'Quote " slash \\ newline\nend',
          objectives: [],
        },
      ],
    },
  });

  assert.match(source, /Quote \\" slash \\\\ newline\\nend/);
  assert.doesNotMatch(source, /newline\nend"/);
});

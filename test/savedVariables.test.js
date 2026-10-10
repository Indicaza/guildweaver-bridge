import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  assertSupportedSavedVariablesSchema,
  outboundTelemetry,
  parseSavedVariables,
  savedVariablesSchemaVersion,
} from "../src/savedVariables.js";

const fixture = `
GuildweaverDB = {
  ["schemaVersion"] = 2,
  ["sync"] = {
    ["outbound"] = {
      ["characters"] = {
        ["classic beta pve 2:rook"] = {
          ["revision"] = 7,
          ["updatedAt"] = 1791160000,
          ["payload"] = {
            ["schemaVersion"] = 1,
            ["name"] = "Rook",
            ["realm"] = "Classic Beta PvE 2",
            ["level"] = 20,
            ["class"] = {
              ["name"] = "Warrior",
            },
            ["professions"] = {
              [1] = {
                ["name"] = "Mining",
                ["skillLevel"] = 150,
              },
              [2] = {
                ["name"] = "Blacksmithing",
                ["skillLevel"] = 112,
              },
            },
            ["guild"] = nil,
          },
        },
      },
    },
  },
}
`;

const schema4Fixture = fs.readFileSync(
  new URL("../fixtures/savedvariables/schema4.lua", import.meta.url),
  "utf8",
);

test("parses legacy Guildweaver SavedVariables without executing Lua", () => {
  const database = parseSavedVariables(fixture);
  const envelope = database.sync.outbound.characters["classic beta pve 2:rook"];

  assert.equal(savedVariablesSchemaVersion(database), 2);
  assert.equal(assertSupportedSavedVariablesSchema(database), 2);
  assert.equal(envelope.revision, 7);
  assert.equal(envelope.payload.name, "Rook");
  assert.equal(envelope.payload.class.name, "Warrior");
  assert.equal(envelope.payload.guild, null);
  assert.deepEqual(
    envelope.payload.professions.map((profession) => profession.name),
    ["Mining", "Blacksmithing"],
  );
  assert.deepEqual(outboundTelemetry(database), {});
});

test("parses SavedVariables schema 4 generic telemetry", () => {
  const database = parseSavedVariables(schema4Fixture);
  const telemetry = outboundTelemetry(database);
  const record = telemetry["character_snapshot:character-fixture"];

  assert.equal(savedVariablesSchemaVersion(database), 4);
  assert.equal(assertSupportedSavedVariablesSchema(database), 4);
  assert.equal(record.revision, 3);
  assert.equal(record.envelope.schemaVersion, 1);
  assert.equal(record.envelope.eventType, "character_snapshot");
  assert.equal(record.envelope.installationId, "install-fixture");
  assert.equal(record.envelope.payload.name, "Rook");
});

test("accepts pre-versioned legacy SavedVariables", () => {
  const database = parseSavedVariables("GuildweaverDB = { [\"characters\"] = {} }");
  assert.equal(savedVariablesSchemaVersion(database), 0);
  assert.equal(assertSupportedSavedVariablesSchema(database), 0);
});

test("rejects future SavedVariables schemas cleanly", () => {
  assert.throws(
    () => assertSupportedSavedVariablesSchema({ schemaVersion: 999 }),
    /Unsupported Guildweaver SavedVariables schema 999/,
  );
});

test("rejects unsupported executable Lua expressions", () => {
  assert.throws(
    () => parseSavedVariables("GuildweaverDB = os.execute('nope')"),
    /Unsupported Lua value|Expected/,
  );
});

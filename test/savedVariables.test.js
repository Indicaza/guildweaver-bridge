import assert from "node:assert/strict";
import test from "node:test";

import { outboundCharacters, parseSavedVariables } from "../src/savedVariables.js";

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

test("parses Guildweaver SavedVariables without executing Lua", () => {
  const database = parseSavedVariables(fixture);
  const outbound = outboundCharacters(database);
  const envelope = outbound["classic beta pve 2:rook"];

  assert.equal(database.schemaVersion, 2);
  assert.equal(envelope.revision, 7);
  assert.equal(envelope.payload.name, "Rook");
  assert.equal(envelope.payload.class.name, "Warrior");
  assert.equal(envelope.payload.guild, null);
  assert.deepEqual(
    envelope.payload.professions.map((profession) => profession.name),
    ["Mining", "Blacksmithing"],
  );
});

test("rejects unsupported executable Lua expressions", () => {
  assert.throws(
    () => parseSavedVariables("GuildweaverDB = os.execute('nope')"),
    /Unsupported Lua value|Expected/,
  );
});

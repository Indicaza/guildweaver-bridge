GuildweaverDB = {
  ["schemaVersion"] = 4,
  ["sync"] = {
    ["outbound"] = {
      ["characters"] = {},
      ["telemetry"] = {
        ["profession_snapshot:character-fixture"] = {
          ["kind"] = "state",
          ["revision"] = 2,
          ["updatedAt"] = 1791322510,
          ["fingerprint"] = "5e1f0a77",
          ["envelope"] = {
            ["schemaVersion"] = 1,
            ["eventType"] = "profession_snapshot",
            ["capturedAt"] = 1791322510,
            ["gameBuild"] = {
              ["version"] = "1.60.1",
              ["build"] = "70245",
              ["interface"] = 16001,
            },
            ["realm"] = "Classic Beta PvE 2",
            ["region"] = "US",
            ["installationId"] = "install-fixture",
            ["characterId"] = "character-fixture",
            ["addon"] = { ["name"] = "Guildweaver", ["version"] = "0.5.0-alpha.1" },
            ["payloadSchemaVersion"] = 1,
            ["payload"] = {
              ["schemaVersion"] = 1,
              ["professions"] = {
                {
                  ["skillLineId"] = 164,
                  ["name"] = "Blacksmithing",
                  ["kind"] = "primary",
                  ["iconFileDataId"] = 136241,
                  ["skillLevel"] = 120,
                  ["maxSkillLevel"] = 150,
                  ["skillModifier"] = 5,
                  ["recipeBook"] = {
                    ["source"] = "C_TradeSkillUI",
                    ["capturedAt"] = 1791322500,
                    ["recipeCount"] = 1,
                    ["knownCount"] = 1,
                  },
                  ["recipes"] = {
                    {
                      ["recipeId"] = 2660,
                      ["spellId"] = 2660,
                      ["name"] = "Rough Sharpening Stone",
                      ["iconFileDataId"] = 135248,
                      ["known"] = true,
                      ["difficulty"] = "trivial",
                      ["relativeDifficulty"] = 3,
                      ["skillUps"] = 1,
                      ["maxTrivialLevel"] = 25,
                      ["description"] = "Sharpens a bladed weapon.",
                      ["cooldown"] = { ["readyAt"] = 1791326100, ["isDayCooldown"] = true },
                      ["crafted"] = {
                        ["itemId"] = 2862,
                        ["name"] = "Rough Sharpening Stone",
                        ["iconFileDataId"] = 135248,
                        ["qualityId"] = 1,
                        ["minQuantity"] = 1,
                        ["maxQuantity"] = 2,
                      },
                      ["reagents"] = {
                        {
                          ["itemId"] = 2835,
                          ["name"] = "Rough Stone",
                          ["iconFileDataId"] = 135232,
                          ["quantity"] = 1,
                          ["required"] = true,
                          ["slotIndex"] = 1,
                        },
                      },
                    },
                  },
                },
                {
                  ["skillLineId"] = 185,
                  ["name"] = "Cooking",
                  ["kind"] = "cooking",
                  ["skillLevel"] = 40,
                  ["maxSkillLevel"] = 75,
                  ["skillModifier"] = 0,
                },
              },
            },
          },
        },
      },
      ["questActions"] = {},
    },
  },
}

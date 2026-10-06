GuildweaverDB = {
  ["schemaVersion"] = 4,
  ["sync"] = {
    ["outbound"] = {
      ["characters"] = {},
      ["telemetry"] = {},
      ["events"] = {
        ["nextSequence"] = 3,
        ["dropped"] = 0,
        ["items"] = {
          ["install-fixture:character-fixture:1"] = {
            ["schemaVersion"] = 1,
            ["eventId"] = "install-fixture:character-fixture:1",
            ["sequence"] = 1,
            ["createdAt"] = 1791246401,
            ["envelope"] = {
              ["schemaVersion"] = 1,
              ["eventType"] = "loot_observation",
              ["capturedAt"] = 1791246401,
              ["realm"] = "Classic Beta PvE 2",
              ["region"] = "US",
              ["installationId"] = "install-fixture",
              ["characterId"] = "character-fixture",
              ["payload"] = {
                ["schemaVersion"] = 1,
                ["reason"] = "LOOT_OPENED",
                ["observedAt"] = 1791246401,
                ["location"] = {
                  ["zone"] = "Wetlands",
                  ["subzone"] = "The Green Belt",
                  ["mapId"] = 56,
                  ["x"] = 0.42,
                  ["y"] = 0.73,
                },
                ["items"] = {
                  [1] = {
                    ["slot"] = 1,
                    ["itemId"] = 765,
                    ["itemLink"] = "|cff1eff00|Hitem:765::::::::30:::::::|h[Silverleaf]|h|r",
                    ["icon"] = 134190,
                    ["name"] = "Silverleaf",
                    ["quantity"] = 3,
                    ["quality"] = 1,
                    ["sources"] = {
                      [1] = {
                        ["guid"] = "GameObject-0-1-2-3-1617-00000009",
                        ["kind"] = "GameObject",
                        ["objectId"] = 1617,
                        ["quantity"] = 3,
                      },
                    },
                  },
                },
              },
            },
          },
          ["install-fixture:character-fixture:2"] = {
            ["schemaVersion"] = 1,
            ["eventId"] = "install-fixture:character-fixture:2",
            ["sequence"] = 2,
            ["createdAt"] = 1791246402,
            ["envelope"] = {
              ["schemaVersion"] = 1,
              ["eventType"] = "craft_completed",
              ["capturedAt"] = 1791246402,
              ["realm"] = "Classic Beta PvE 2",
              ["region"] = "US",
              ["installationId"] = "install-fixture",
              ["characterId"] = "character-fixture",
              ["payload"] = {
                ["recipeId"] = 456,
                ["craftedItemId"] = 789,
              },
            },
          },
          ["install-fixture:character-fixture:3"] = {
            ["schemaVersion"] = 1,
            ["eventId"] = "install-fixture:character-fixture:3",
            ["sequence"] = 3,
            ["createdAt"] = 1791246403,
            ["envelope"] = {
              ["schemaVersion"] = 1,
              ["eventType"] = "recipe_learned",
              ["capturedAt"] = 1791246403,
              ["realm"] = "Classic Beta PvE 2",
              ["region"] = "US",
              ["installationId"] = "install-fixture",
              ["characterId"] = "character-fixture",
              ["payload"] = {
                ["recipeId"] = 999,
              },
            },
          },
        },
      },
      ["questActions"] = {},
    },
  },
}

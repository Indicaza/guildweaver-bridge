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
              ["eventType"] = "item_looted",
              ["capturedAt"] = 1791246401,
              ["realm"] = "Classic Beta PvE 2",
              ["region"] = "US",
              ["installationId"] = "install-fixture",
              ["characterId"] = "character-fixture",
              ["payload"] = {
                ["itemId"] = 123,
                ["quantity"] = 2,
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

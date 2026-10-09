GuildweaverDB = {
  ["schemaVersion"] = 4,
  ["sync"] = {
    ["outbound"] = {
      ["characters"] = {},
      ["telemetry"] = {
        ["inventory_snapshot:character-fixture"] = {
          ["kind"] = "state",
          ["revision"] = 3,
          ["updatedAt"] = 1791322510,
          ["fingerprint"] = "9c41d2e0",
          ["envelope"] = {
            ["schemaVersion"] = 1,
            ["eventType"] = "inventory_snapshot",
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
            ["addon"] = {
              ["name"] = "Guildweaver",
              ["version"] = "0.5.0-alpha.1",
            },
            ["payloadSchemaVersion"] = 1,
            ["payload"] = {
              ["schemaVersion"] = 1,
              ["scope"] = "carried",
              ["source"] = "C_Container",
              ["money"] = {
                ["copper"] = 1234567,
              },
              ["slotCount"] = 22,
              ["freeSlots"] = 16,
              ["containers"] = {
                {
                  ["bagId"] = 0,
                  ["kind"] = "backpack",
                  ["name"] = "Backpack",
                  ["slotCount"] = 16,
                  ["freeSlots"] = 12,
                  ["bagFamily"] = 0,
                  ["iconFileDataId"] = 133633,
                  ["slots"] = {
                    {
                      ["slot"] = 1,
                      ["itemKey"] = "item:6948::::::::20:::::::",
                      ["itemId"] = 6948,
                      ["count"] = 1,
                      ["isBound"] = true,
                    },
                    {
                      ["slot"] = 2,
                      ["itemKey"] = "item:2770::::::::20:::::::",
                      ["itemId"] = 2770,
                      ["count"] = 20,
                    },
                    {
                      ["slot"] = 3,
                      ["itemKey"] = "item:2770::::::::20:::::::",
                      ["itemId"] = 2770,
                      ["count"] = 3,
                    },
                    {
                      ["slot"] = 7,
                      ["itemKey"] = "item:15210::::::1027:0:20:::::::",
                      ["itemId"] = 15210,
                      ["count"] = 1,
                      ["isBound"] = true,
                    },
                  },
                },
                {
                  ["bagId"] = 1,
                  ["kind"] = "bag",
                  ["name"] = "Linen Bag",
                  ["slotCount"] = 6,
                  ["freeSlots"] = 4,
                  ["bagFamily"] = 0,
                  ["iconFileDataId"] = 133622,
                  ["item"] = {
                    ["itemId"] = 4238,
                    ["name"] = "Linen Bag",
                    ["itemLink"] = "|cffffffff|Hitem:4238::::::::20:::::::|h[Linen Bag]|h|r",
                    ["iconFileDataId"] = 133622,
                    ["qualityId"] = 1,
                  },
                  ["slots"] = {
                    {
                      ["slot"] = 1,
                      ["itemKey"] = "item:2318::::::::20:::::::",
                      ["itemId"] = 2318,
                      ["count"] = 7,
                    },
                    {
                      ["slot"] = 2,
                      ["itemKey"] = "item:2770::::::::20:::::::",
                      ["itemId"] = 2770,
                      ["count"] = 2,
                    },
                  },
                },
              },
              ["items"] = {
                {
                  ["key"] = "item:15210::::::1027:0:20:::::::",
                  ["itemId"] = 15210,
                  ["itemLink"] = "|cff1eff00|Hitem:15210::::::1027:0:20:::::::|h[Raider Shortsword of the Tiger]|h|r",
                  ["name"] = "Raider Shortsword of the Tiger",
                  ["iconFileDataId"] = 135274,
                  ["qualityId"] = 2,
                  ["itemLevel"] = 18,
                  ["requiredLevel"] = 13,
                  ["maxStackSize"] = 1,
                  ["sellPrice"] = 461,
                  ["bindType"] = 2,
                  ["equipLocation"] = "INVTYPE_WEAPON",
                  ["expansionId"] = 0,
                  ["isCraftingReagent"] = false,
                  ["itemClass"] = {
                    ["id"] = 2,
                    ["name"] = "Weapon",
                  },
                  ["itemSubclass"] = {
                    ["id"] = 7,
                    ["name"] = "One-Handed Swords",
                  },
                  ["suffixId"] = 1027,
                  ["stats"] = {
                    ["ITEM_MOD_STRENGTH_SHORT"] = 2,
                    ["ITEM_MOD_AGILITY_SHORT"] = 2,
                  },
                  ["tooltip"] = {
                    ["source"] = "C_TooltipInfo",
                    ["lines"] = {
                      {
                        ["left"] = "Raider Shortsword of the Tiger",
                        ["leftColor"] = {
                          ["r"] = 0.12,
                          ["g"] = 1,
                          ["b"] = 0,
                          ["a"] = 1,
                        },
                      },
                      {
                        ["left"] = "Soulbound",
                      },
                      {
                        ["left"] = "One-Hand",
                        ["right"] = "Sword",
                      },
                      {
                        ["left"] = "10 - 19 Damage",
                        ["right"] = "Speed 2.30",
                      },
                      {
                        ["left"] = "(6.3 damage per second)",
                      },
                      {
                        ["left"] = "+2 Strength",
                      },
                      {
                        ["left"] = "+2 Agility",
                      },
                      {
                        ["left"] = "Durability 55 / 55",
                      },
                      {
                        ["left"] = "Requires Level 13",
                      },
                    },
                  },
                },
                {
                  ["key"] = "item:2318::::::::20:::::::",
                  ["itemId"] = 2318,
                  ["itemLink"] = "|cffffffff|Hitem:2318::::::::20:::::::|h[Light Leather]|h|r",
                  ["name"] = "Light Leather",
                  ["iconFileDataId"] = 134252,
                  ["qualityId"] = 1,
                  ["itemLevel"] = 10,
                  ["requiredLevel"] = 0,
                  ["maxStackSize"] = 20,
                  ["sellPrice"] = 15,
                  ["bindType"] = 0,
                  ["equipLocation"] = "",
                  ["expansionId"] = 0,
                  ["isCraftingReagent"] = true,
                  ["itemClass"] = {
                    ["id"] = 7,
                    ["name"] = "Trade Goods",
                  },
                  ["itemSubclass"] = {
                    ["id"] = 6,
                    ["name"] = "Leather",
                  },
                  ["tooltip"] = {
                    ["source"] = "C_TooltipInfo",
                    ["lines"] = {
                      {
                        ["left"] = "Light Leather",
                        ["leftColor"] = {
                          ["r"] = 1,
                          ["g"] = 1,
                          ["b"] = 1,
                          ["a"] = 1,
                        },
                      },
                      {
                        ["left"] = "Crafting Reagent",
                        ["leftColor"] = {
                          ["r"] = 0.4,
                          ["g"] = 0.73,
                          ["b"] = 1,
                          ["a"] = 1,
                        },
                      },
                    },
                  },
                },
                {
                  ["key"] = "item:2770::::::::20:::::::",
                  ["itemId"] = 2770,
                  ["itemLink"] = "|cffffffff|Hitem:2770::::::::20:::::::|h[Copper Ore]|h|r",
                  ["name"] = "Copper Ore",
                  ["iconFileDataId"] = 134566,
                  ["qualityId"] = 1,
                  ["itemLevel"] = 10,
                  ["requiredLevel"] = 0,
                  ["maxStackSize"] = 20,
                  ["sellPrice"] = 5,
                  ["bindType"] = 0,
                  ["equipLocation"] = "",
                  ["expansionId"] = 0,
                  ["isCraftingReagent"] = true,
                  ["itemClass"] = {
                    ["id"] = 7,
                    ["name"] = "Trade Goods",
                  },
                  ["itemSubclass"] = {
                    ["id"] = 7,
                    ["name"] = "Metal & Stone",
                  },
                  ["tooltip"] = {
                    ["source"] = "C_TooltipInfo",
                    ["lines"] = {
                      {
                        ["left"] = "Copper Ore",
                        ["leftColor"] = {
                          ["r"] = 1,
                          ["g"] = 1,
                          ["b"] = 1,
                          ["a"] = 1,
                        },
                      },
                      {
                        ["left"] = "Crafting Reagent",
                        ["leftColor"] = {
                          ["r"] = 0.4,
                          ["g"] = 0.73,
                          ["b"] = 1,
                          ["a"] = 1,
                        },
                      },
                    },
                  },
                },
                {
                  ["key"] = "item:6948::::::::20:::::::",
                  ["itemId"] = 6948,
                  ["itemLink"] = "|cffffffff|Hitem:6948::::::::20:::::::|h[Hearthstone]|h|r",
                  ["name"] = "Hearthstone",
                  ["iconFileDataId"] = 134414,
                  ["qualityId"] = 1,
                  ["itemLevel"] = 1,
                  ["requiredLevel"] = 0,
                  ["maxStackSize"] = 1,
                  ["sellPrice"] = 0,
                  ["bindType"] = 1,
                  ["equipLocation"] = "",
                  ["expansionId"] = 0,
                  ["isCraftingReagent"] = false,
                  ["itemClass"] = {
                    ["id"] = 15,
                    ["name"] = "Miscellaneous",
                  },
                  ["itemSubclass"] = {
                    ["id"] = 0,
                    ["name"] = "Junk",
                  },
                  ["spell"] = {
                    ["name"] = "Hearthstone",
                    ["id"] = 8690,
                  },
                  ["tooltip"] = {
                    ["source"] = "C_TooltipInfo",
                    ["lines"] = {
                      {
                        ["left"] = "Hearthstone",
                        ["leftColor"] = {
                          ["r"] = 1,
                          ["g"] = 1,
                          ["b"] = 1,
                          ["a"] = 1,
                        },
                      },
                      {
                        ["left"] = "Soulbound",
                      },
                      {
                        ["left"] = "Unique",
                      },
                      {
                        ["left"] = "Use: Returns you to Goldshire. Speak to an Innkeeper in a different place to change your home location.",
                        ["leftColor"] = {
                          ["r"] = 0,
                          ["g"] = 1,
                          ["b"] = 0,
                          ["a"] = 1,
                        },
                      },
                    },
                  },
                },
              },
              ["totals"] = {
                {
                  ["itemId"] = 2318,
                  ["count"] = 7,
                  ["stacks"] = 1,
                },
                {
                  ["itemId"] = 2770,
                  ["count"] = 25,
                  ["stacks"] = 3,
                },
                {
                  ["itemId"] = 6948,
                  ["count"] = 1,
                  ["stacks"] = 1,
                },
                {
                  ["itemId"] = 15210,
                  ["count"] = 1,
                  ["stacks"] = 1,
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

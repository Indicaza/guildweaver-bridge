const TYPES = {
  character: ["character", "character_snapshot", "stats", "equipment", "talents", "inventory_snapshot", "talent_tree_definition"],
  professions: ["professions", "profession_snapshot", "profession_recipe", "recipe_definition", "profession_recipe_definition"],
  ah: ["auction_scan"],
  dungeons: ["dungeon_run", "dungeon_session", "dungeon_loot", "loot_catalog_snapshot"],
  gathering: ["gathering_loot", "farming_session"],
  loot: ["mob_loot", "loot_roll", "game_item_definition", "loot_catalog_snapshot"],
  quests: ["quest_state"],
  wishlist: [],
};
export const SYNC_DOMAINS = ["all", "telemetry", ...Object.keys(TYPES)];
export function normalizeDomains(input = []) {
  if (!Array.isArray(input) || input.some((value) => !SYNC_DOMAINS.includes(value))) throw new Error("Unknown sync domain. Choose " + SYNC_DOMAINS.join(", "));
  if (!input.length || input.includes("all")) return null;
  return new Set(input);
}
export function includesEvent(domains, eventType) {
  if (!domains || domains.has("telemetry")) return true;
  return [...domains].some((domain) => TYPES[domain]?.includes(eventType));
}

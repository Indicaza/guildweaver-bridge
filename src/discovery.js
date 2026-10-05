import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const INSTALL_VARIANTS = [
  "_classic_beta_",
  "_anniversary_",
  "_classic_",
  "_retail_",
  "_ptr_",
  "_beta_",
];

function existingDirectories(values) {
  return values.filter((value) => value && fs.existsSync(value));
}

function variantRoots(wowDirectories) {
  return wowDirectories.flatMap((wow) =>
    INSTALL_VARIANTS.map((variant) => path.join(wow, variant)),
  );
}

function childDirectories(root) {
  if (!root || !fs.existsSync(root)) return [];

  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function macWowDirectories() {
  const candidates = [
    "/Applications/World of Warcraft",
    path.join(os.homedir(), "Applications", "World of Warcraft"),
  ];

  const volumesRoot = "/Volumes";
  if (fs.existsSync(volumesRoot)) {
    for (const entry of fs.readdirSync(volumesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const volume = path.join(volumesRoot, entry.name);
      candidates.push(path.join(volume, "World of Warcraft"));
      candidates.push(path.join(volume, "Applications", "World of Warcraft"));
    }
  }

  return candidates;
}

function addWinePrefixCandidates(candidates, prefix) {
  if (!prefix) return;
  candidates.push(
    path.join(prefix, "drive_c", "Program Files (x86)", "World of Warcraft"),
    path.join(prefix, "drive_c", "Program Files", "World of Warcraft"),
  );
}

export function linuxWowDirectories({
  homeDirectory = os.homedir(),
  env = process.env,
} = {}) {
  const candidates = [path.join(homeDirectory, "Games", "World of Warcraft")];

  addWinePrefixCandidates(candidates, env.WINEPREFIX);
  addWinePrefixCandidates(candidates, path.join(homeDirectory, ".wine"));

  const gamesRoot = path.join(homeDirectory, "Games");
  for (const gameRoot of childDirectories(gamesRoot)) {
    candidates.push(path.join(gameRoot, "World of Warcraft"));
    addWinePrefixCandidates(candidates, gameRoot);
  }

  const bottleRoots = [
    path.join(homeDirectory, ".local", "share", "bottles", "bottles"),
    path.join(
      homeDirectory,
      ".var",
      "app",
      "com.usebottles.bottles",
      "data",
      "bottles",
      "bottles",
    ),
  ];
  for (const bottleRoot of bottleRoots) {
    for (const bottle of childDirectories(bottleRoot)) {
      addWinePrefixCandidates(candidates, bottle);
    }
  }

  const steamCompatRoots = [
    path.join(homeDirectory, ".steam", "steam", "steamapps", "compatdata"),
    path.join(homeDirectory, ".local", "share", "Steam", "steamapps", "compatdata"),
  ];
  for (const compatRoot of steamCompatRoots) {
    for (const compatData of childDirectories(compatRoot)) {
      addWinePrefixCandidates(candidates, path.join(compatData, "pfx"));
    }
  }

  return [...new Set(candidates)];
}

export function findWowRoots() {
  const roots = [];

  if (process.platform === "darwin") {
    roots.push(...variantRoots(macWowDirectories()));
    return [...new Set(existingDirectories(roots))];
  }

  if (process.platform === "linux") {
    roots.push(...variantRoots(linuxWowDirectories()));
    return [...new Set(existingDirectories(roots))];
  }

  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const programFiles = process.env.ProgramFiles;

  for (const base of existingDirectories([programFilesX86, programFiles])) {
    roots.push(...variantRoots([path.join(base, "World of Warcraft")]));
  }

  for (const drive of ["C:", "D:", "E:"]) {
    roots.push(...variantRoots([path.join(drive, "World of Warcraft")]));
  }

  return [...new Set(existingDirectories(roots))];
}

function accountSavedVariableFiles(wowRoot) {
  const accountRoot = path.join(wowRoot, "WTF", "Account");

  if (!fs.existsSync(accountRoot)) {
    return [];
  }

  const files = [];

  for (const entry of fs.readdirSync(accountRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = path.join(
      accountRoot,
      entry.name,
      "SavedVariables",
      "Guildweaver.lua",
    );

    if (fs.existsSync(candidate)) {
      files.push(candidate);
    }
  }

  return files;
}

export function findAddonPath(config) {
  if (config.addonPath) {
    return config.addonPath;
  }

  const roots = config.wowRoot ? [config.wowRoot] : findWowRoots();
  const existing = roots
    .map((root) => path.join(root, "Interface", "AddOns", "Guildweaver"))
    .find((candidate) => fs.existsSync(candidate));

  if (existing) {
    return existing;
  }

  const rootWithSavedVariables = roots.find(
    (root) => accountSavedVariableFiles(root).length > 0,
  );
  const targetRoot = rootWithSavedVariables || roots[0];

  if (!targetRoot) {
    throw new Error("World of Warcraft installation was not found");
  }

  return path.join(targetRoot, "Interface", "AddOns", "Guildweaver");
}

export function findSavedVariablesFiles(config) {
  if (config.savedVariablesPath) {
    if (!fs.existsSync(config.savedVariablesPath)) {
      throw new Error(`SavedVariables file not found: ${config.savedVariablesPath}`);
    }

    return [config.savedVariablesPath];
  }

  const roots = config.wowRoot ? [config.wowRoot] : findWowRoots();
  const files = [...new Set(roots.flatMap(accountSavedVariableFiles))];

  if (!files.length) {
    const hint = config.wowRoot
      ? ` under ${config.wowRoot}`
      : " in the standard World of Warcraft install locations";
    throw new Error(`Guildweaver.lua was not found${hint}`);
  }

  return files;
}

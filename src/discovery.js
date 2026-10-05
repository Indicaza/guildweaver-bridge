import fs from "node:fs";
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

export function findWowRoots() {
  const roots = [];
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const programFiles = process.env.ProgramFiles;

  for (const base of existingDirectories([programFilesX86, programFiles])) {
    const wow = path.join(base, "World of Warcraft");

    for (const variant of INSTALL_VARIANTS) {
      roots.push(path.join(wow, variant));
    }
  }

  for (const drive of ["C:", "D:", "E:"]) {
    const wow = path.join(drive, "World of Warcraft");

    for (const variant of INSTALL_VARIANTS) {
      roots.push(path.join(wow, variant));
    }
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

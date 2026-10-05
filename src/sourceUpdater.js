import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function repositoryRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function runGit(cwd, args, execImpl = execFileSync) {
  return String(
    execImpl("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }) || "",
  ).trim();
}

export function updateBridgeSource({
  checkoutPath = repositoryRoot(),
  execImpl = execFileSync,
} = {}) {
  if (!fs.existsSync(path.join(checkoutPath, ".git"))) {
    return { status: "not-source-checkout", path: checkoutPath };
  }

  const dirty = runGit(checkoutPath, ["status", "--porcelain"], execImpl);
  if (dirty) {
    return { status: "dirty", path: checkoutPath };
  }

  const branch = runGit(checkoutPath, ["branch", "--show-current"], execImpl);
  if (branch !== "main") {
    return { status: "branch", branch, path: checkoutPath };
  }

  runGit(checkoutPath, ["fetch", "origin", "main"], execImpl);
  const before = runGit(checkoutPath, ["rev-parse", "HEAD"], execImpl);
  const remote = runGit(checkoutPath, ["rev-parse", "origin/main"], execImpl);

  if (before === remote) {
    return { status: "current", commit: before, path: checkoutPath };
  }

  runGit(checkoutPath, ["merge", "--ff-only", "origin/main"], execImpl);
  const after = runGit(checkoutPath, ["rev-parse", "HEAD"], execImpl);

  return {
    status: "updated",
    previousCommit: before,
    commit: after,
    path: checkoutPath,
  };
}

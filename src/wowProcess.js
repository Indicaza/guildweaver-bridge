import { spawnSync } from "node:child_process";

const WOW_PROCESS_PATTERNS = [
  /(?:^|[\\/\s])wow(?:classic|t|b)?(?:\.exe)?(?:$|\s)/i,
  /world of warcraft(?:\.app)?/i,
];

export function processListShowsWow(output) {
  const text = String(output || "");
  return WOW_PROCESS_PATTERNS.some((pattern) => pattern.test(text));
}

export function isWowRunning({
  platform = process.platform,
  spawnSyncImpl = spawnSync,
} = {}) {
  try {
    const command = platform === "win32" ? "tasklist.exe" : "ps";
    const args = platform === "win32"
      ? ["/FO", "CSV", "/NH"]
      : ["-A", "-o", "comm=", "-o", "args="];
    const result = spawnSyncImpl(command, args, {
      encoding: "utf8",
      windowsHide: true,
    });

    if (result.error || (result.status !== 0 && result.status !== null)) {
      return false;
    }

    return processListShowsWow(result.stdout);
  } catch {
    return false;
  }
}

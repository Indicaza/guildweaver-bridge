import { setTimeout as sleep } from "node:timers/promises";
import { requestAgent } from "../agent.js";
import { lockedInstanceStatus } from "../instanceLock.js";

export async function completeBridgeUpdate(config, result, {
  previousPid, progress = () => {}, request = requestAgent,
  lockStatus = lockedInstanceStatus, now = Date.now, wait = sleep, timeoutMs = 120_000,
} = {}) {
  if (result.bridge?.status !== "restart-scheduled") return result;
  const staged = result.bridge;
  const oldPid = staged.previousPid || previousPid;
  if (!oldPid || typeof staged.commit !== "string" || !/^[a-f0-9]{40}$/i.test(staged.commit)) {
    result.bridge = { status: "failed", detail: "Could not identify the requested bridge update." };
    return result;
  }
  progress({ component: "bridge", stage: "activation-check" });
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    try {
      const lock = lockStatus(config.lockPath);
      if (lock.running && lock.pid !== oldPid) {
        const ping = await request(config, "ping", [], { timeoutMs: Math.min(1500, Math.max(1, deadline - now())) });
        if (ping.ready === true && ping.pid === lock.pid && ping.pid !== oldPid && ping.commit === staged.commit) {
          result.bridge = { status: "updated", commit: staged.commit, releaseVersion: staged.releaseVersion };
          return result;
        }
      }
    } catch {}
    await wait(Math.min(500, Math.max(0, deadline - now())));
  }
  result.bridge = { status: "failed", detail: "The new bridge did not confirm startup. Check gw doctor and gw logs." };
  return result;
}

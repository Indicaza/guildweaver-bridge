import fs from "node:fs";
import path from "node:path";

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readLock(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

export function acquireInstanceLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const existing = readLock(lockPath);
  if (existing?.pid && processExists(Number(existing.pid))) {
    return null;
  }

  fs.rmSync(lockPath, { force: true });

  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(
      fd,
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    fs.closeSync(fd);
  } catch (error) {
    if (error?.code === "EEXIST") return null;
    throw error;
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;

    const current = readLock(lockPath);
    if (Number(current?.pid) === process.pid) {
      fs.rmSync(lockPath, { force: true });
    }
  };

  process.once("exit", release);
  process.once("SIGINT", () => {
    release();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    release();
    process.exit(0);
  });

  return release;
}

export function stopLockedInstance(lockPath) {
  const current = readLock(lockPath);
  const pid = Number(current?.pid);

  if (processExists(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return false;
    }
  }

  fs.rmSync(lockPath, { force: true });
  return true;
}

export function lockedInstanceStatus(lockPath) {
  const current = readLock(lockPath);
  const pid = Number(current?.pid);
  return {
    running: processExists(pid),
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    startedAt: current?.startedAt || null,
  };
}

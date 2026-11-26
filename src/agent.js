import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes, timingSafeEqual } from "node:crypto";

const MAX_BYTES = 16 * 1024;
const descriptorPath = (config) => config.lockPath + ".agent.json";
function safeEqual(a, b) {
  if (typeof a !== "string" || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export async function startAgent(config, handler) {
  const token = randomBytes(32).toString("hex");
  const dir = process.platform === "win32" ? null : fs.mkdtempSync(path.join(os.tmpdir(), "gw-"));
  const address = dir ? path.join(dir, "s") : "\\\\.\\pipe\\guildweaver-" + randomBytes(16).toString("hex");
  let closing = false;
  const server = net.createServer((socket) => {
    socket.setTimeout(120_000, () => socket.destroy());
    socket.on("error", () => {});
    let buffer = "";
    let accepted = false;
    socket.on("data", async (chunk) => {
      if (accepted) return;
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > MAX_BYTES) { socket.destroy(); return; }
      if (!buffer.includes("\n")) return;
      accepted = true;
      try {
        const request = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
        if (closing || !safeEqual(request.token, token)) throw new Error("Agent authorization failed");
        const result = await handler(request.command, request.args);
        socket.end(JSON.stringify({ ok: true, result }) + "\n");
      } catch (error) {
        socket.end(JSON.stringify({ ok: false, error: String(error.message).slice(0, 500) }) + "\n");
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, resolve);
  });
  const descriptor = descriptorPath(config);
  const temp = descriptor + "." + process.pid + ".tmp";
  fs.mkdirSync(path.dirname(descriptor), { recursive: true });
  try {
    fs.writeFileSync(temp, JSON.stringify({ address, token, pid: process.pid }), { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, descriptor);
  } catch (error) {
    server.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(temp, { force: true });
    throw error;
  }
  const clean = () => {
    try {
      if (JSON.parse(fs.readFileSync(descriptor, "utf8")).token === token) fs.rmSync(descriptor, { force: true });
    } catch {}
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  };
  process.once("exit", clean);
  server.unref();
  return () => { closing = true; server.close(); clean(); process.removeListener("exit", clean); };
}
export async function requestAgent(config, command, args = []) {
  let descriptor;
  try {
    descriptor = JSON.parse(fs.readFileSync(descriptorPath(config), "utf8"));
    if (typeof descriptor.address !== "string" || typeof descriptor.token !== "string") throw new Error();
  } catch { throw new Error("Guildweaver background agent is not available. Start the installed bridge first."); }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(descriptor.address);
    let buffer = "";
    socket.setTimeout(120_000, () => socket.destroy(new Error("Agent response timed out; the operation may still be running")));
    socket.once("error", reject);
    socket.once("connect", () => socket.write(JSON.stringify({ token: descriptor.token, command, args }) + "\n"));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer) > MAX_BYTES) { socket.destroy(new Error("Agent response too large")); return; }
      if (!buffer.includes("\n")) return;
      try {
        const response = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
        if (!response.ok) throw new Error(response.error || "Agent operation failed");
        resolve(response.result);
      } catch (error) { reject(error); }
      socket.end();
    });
    socket.once("end", () => reject(new Error("Agent disconnected before replying")));
  });
}

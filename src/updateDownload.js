import fs from "node:fs";

const MAX_BYTES = 256 * 1024 * 1024;
export async function downloadUpdate(response, destination, progress = () => {}) {
  const declared = Number(response.headers.get("content-length"));
  const total = Number.isSafeInteger(declared) && declared > 0 && !response.headers.get("content-encoding") ? declared : null;
  if (total > MAX_BYTES) throw new Error("Update archive exceeds size limit");
  if (!response.body) throw new Error("Update archive has no body");
  let received = 0, lastReport = 0;
  const reader = response.body.getReader();
  let fd;
  try {
    fd = fs.openSync(destination, "wx", 0o600);
    progress({ stage: "downloading", received, total });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > MAX_BYTES) throw new Error("Update archive exceeds size limit");
      let offset = 0;
      while (offset < value.byteLength) {
        const written = fs.writeSync(fd, value, offset, value.byteLength - offset);
        if (written <= 0) throw new Error("Unable to write update archive");
        offset += written;
      }
      received += value.byteLength;
      if (Date.now() - lastReport >= 125) {
        progress({ stage: "downloading", received, total });
        lastReport = Date.now();
      }
    }
    if (total !== null && received !== total) throw new Error("Update archive download was incomplete");
    fs.fsyncSync(fd);
    progress({ stage: "downloaded", received, total });
  } catch (error) {
    try { await reader.cancel(); } catch {}
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    reader.releaseLock();
  }
}

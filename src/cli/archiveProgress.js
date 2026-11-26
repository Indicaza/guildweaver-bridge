import { gold, green, muted, warn } from "./output.js";

function size(bytes = 0) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KiB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MiB";
}

export function createArchiveProgress({ stream = process.stderr, json = false } = {}) {
  let last = "", live = false;
  const clear = () => { if (live) { stream.write("\r\x1b[2K"); live = false; } };
  const show = (event) => {
    if (json) return;
    let line;
    const page = event.page ? "page " + event.page + " · " : "";
    const counts = (event.pages ?? 0) + " pages · " + (event.rows ?? 0).toLocaleString("en-US") + " rows · " + size(event.bytes);
    if (event.stage === "queued") line = gold("◆") + " " + page + "Queued · position " + event.position;
    else if (event.stage === "running") line = gold("◆") + " " + page + "Reading archive page";
    else if (event.stage === "retry") line = warn("↻") + " " + page + (event.busy ? "Server busy" : "Connection retry") + " · next attempt in " + Math.ceil(event.delayMs / 1000) + "s";
    else if (event.stage === "expired") line = warn("↻") + " " + page + "Queue ticket expired; requesting a new one";
    else if (event.stage === "received") line = gold("◆") + " " + page + "Downloaded · checking SHA-256";
    else if (event.stage === "verified") line = green("✓") + " " + page + "Checksum verified · saving";
    else if (event.stage === "resume") line = muted("↳") + " Verified existing archive · " + counts;
    else if (event.stage === "saved") line = green("✓") + " Saved · " + counts;
    else if (event.stage === "complete") line = green("✓") + " Export complete · " + counts;
    else if (event.stage === "paused") line = warn("◆") + " Export paused · rerun to resume · " + counts;
    else return;
    if (line === last) return;
    last = line;
    const durable = ["resume", "complete", "paused"].includes(event.stage) || (event.stage === "saved" && (event.pages === 1 || event.pages % 10 === 0));
    if (stream.isTTY) {
      clear();
      stream.write(line + (durable ? "\n" : ""));
      live = !durable;
    } else if (durable || ["retry", "queued", "running", "expired"].includes(event.stage)) stream.write(line + "\n");
  };
  return { show, finish() { if (live) { stream.write("\n"); live = false; } } };
}

import { describeUpdate } from "./updateStatus.js";
import { green, gold, warn, red } from "./output.js";

const names = { addon: "Addon", bridge: "Bridge" };

export function progressBar(event, frame = 0, width = 12) {
  const received = event?.received, total = event?.total;
  if (event?.stage === "downloading" && Number.isFinite(received) && received >= 0 && Number.isFinite(total) && total > 0) {
    const fraction = Math.max(0, Math.min(1, received / total));
    const filled = Math.floor(fraction * width);
    return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "] " + Math.floor(fraction * 100) + "%";
  }
  const travel = Math.max(1, width - 2);
  const position = frame % (travel * 2);
  const start = position <= travel ? position : travel * 2 - position;
  return "[" + "░".repeat(start) + "██" + "░".repeat(width - start - 2) + "]";
}

export function updateAction(result) {
  if (!["updated", "developer-updated"].includes(result?.status) || result.action === "next-launch") return "";
  return "Type /reload in WoW.";
}

export function createUpdateProgress(target, { stream = process.stdout, json = false } = {}) {
  const components = target === "all" ? ["addon", "bridge"] : [target];
  const states = Object.fromEntries(components.map(key => [key, { label: "Updating", tone: "info" }]));
  const events = {};
  let rendered = false, finished = false, frame = 0, timer;
  const tty = stream.isTTY && (stream.columns || 80) >= 38;
  const row = key => {
    const state = states[key];
    let value;
    if (state.tone === "success") value = green("✓ Up to date");
    else if (state.tone === "error") value = red("✖ Failed");
    else {
      const width = Math.max(4, Math.min(16, (stream.columns || 80) - 29));
      value = gold("Updating " + progressBar(events[key], frame, width));
    }
    return "  " + names[key].padEnd(8) + "  " + value;
  };
  const draw = () => {
    if (json || !tty) return;
    if (rendered) stream.write("\x1b[" + components.length + "A");
    for (const key of components) stream.write("\r\x1b[2K" + row(key) + "\n");
    rendered = true;
  };
  const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
  const finishRows = () => {
    stop();
    if (tty) draw();
    else for (const key of components) stream.write(row(key) + "\n");
  };
  return {
    start() {
      if (json) return;
      stream.write("\n" + gold("◆ GUILDWEAVER") + "  Update\n");
      if (tty) {
        draw();
        timer = setInterval(() => { frame++; draw(); }, 120);
        timer.unref?.();
      }
    },
    show(event) {
      if (json || finished || !components.includes(event?.component)) return;
      const key = event.component;
      if (event.stage === "result") states[key] = describeUpdate(event);
      else {
        states[key] = { label: "Updating", tone: "info" };
        events[key] = event;
      }
      if (event.stage === "result") delete events[key];
      draw();
    },
    finish(result) {
      if (json || finished) return;
      finished = true;
      for (const key of components) states[key] = describeUpdate(result[key]);
      finishRows();
      const action = updateAction(result.addon);
      if (action) stream.write("  " + warn(action) + "\n");
      for (const key of components) {
        if (states[key].tone === "error" && states[key].detail) stream.write("  " + names[key] + ": " + red(states[key].detail) + "\n");
      }
    },
    fail() {
      if (json || finished) return;
      finished = true;
      for (const key of components) if (states[key].tone !== "success") states[key] = { label: "Failed", tone: "error" };
      finishRows();
    },
  };
}

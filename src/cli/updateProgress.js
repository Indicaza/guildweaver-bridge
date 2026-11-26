import { describeUpdate } from "./updateStatus.js";
import { green, gold, warn, red, muted } from "./output.js";

const names = { addon: "Addon", bridge: "Bridge" };
const mb = bytes => (bytes / (1024 * 1024)).toFixed(1) + " MiB";
const safe = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 80) : "";
function version(event) {
  return safe(event.releaseVersion) || safe(event.commit).slice(0, 8);
}
export function updateActivity(event) {
  switch (event.stage) {
    case "checking": return "Checking release metadata";
    case "available": return "Update found" + (version(event) ? " · " + version(event) : "") + " · applying now";
    case "downloading": {
      const received = Number(event.received), total = Number(event.total);
      if (!Number.isFinite(received) || received < 0) return "Downloading update";
      if (!(total > 0) || !Number.isFinite(total)) return "Downloading · " + mb(received);
      const fraction = Math.max(0, Math.min(1, received / total));
      const filled = Math.floor(fraction * 16);
      return "Downloading [" + "█".repeat(filled) + "░".repeat(16 - filled) + "] " + Math.floor(fraction * 100) + "% · " + mb(received) + " / " + mb(total);
    }
    case "downloaded": return "Downloaded · " + mb(event.received);
    case "verifying": return "Verifying SHA-256 checksum";
    case "extracting": return "Extracting verified archive";
    case "installing": return "Installing update";
    case "staging": return "Staging verified bridge package";
    case "restarting": return "Restarting background bridge automatically";
    default: return "";
  }
}

export function updateAction(result) {
  if (!["updated", "developer-updated"].includes(result?.status)) return "";
  return result.action === "next-launch" ? "Ready for your next WoW launch. No reload needed now." : "Type /reload in WoW to activate the updated addon.";
}

export function createUpdateProgress(target, { stream = process.stdout, json = false } = {}) {
  const components = target === "all" ? ["addon", "bridge"] : [target];
  const states = Object.fromEntries(components.map(key => [key, { label: "Checking", tone: "info" }]));
  let activity = "Checking for updates…", rendered = false, finished = false;
  const tty = stream.isTTY && (stream.columns || 80) >= 64;
  const decorated = state => {
    const label = (state.tone === "success" ? "✓ " : state.tone === "error" ? "✖ " : state.tone === "warning" ? "! " : "↻ ") + state.label;
    return state.tone === "success" ? green(label) : state.tone === "error" ? red(label) : state.tone === "warning" ? warn(label) : gold(label);
  };
  const fit = line => {
    const limit = Math.max(20, (stream.columns || 80) - 2);
    return line.length > limit ? line.slice(0, limit - 1) + "…" : line;
  };
  const draw = () => {
    if (json || !tty) return;
    const lines = components.map(key => "  " + names[key].padEnd(8) + "  " + decorated({ ...states[key], label: fit(states[key].label.slice(0, Math.max(16, (stream.columns || 80) - 18))) }));
    lines.push("", "  " + muted(fit(activity).slice(0, Math.max(16, (stream.columns || 80) - 4))));
    if (rendered) stream.write("\x1b[" + lines.length + "A");
    for (const line of lines) stream.write("\r\x1b[2K" + line + "\n");
    rendered = true;
  };
  const set = (key, state) => { states[key] = state; };
  return {
    start() {
      if (json) return;
      stream.write("\n" + gold("◆ GUILDWEAVER") + "  Update\n");
      if (tty) draw();
      else for (const key of components) stream.write("  " + names[key] + "  Checking\n");
    },
    show(event) {
      if (json || finished || !components.includes(event?.component)) return;
      const key = event.component;
      if (event.stage === "result") {
        set(key, describeUpdate(event));
        if (!tty) stream.write("  " + names[key] + "  " + decorated(states[key]) + "\n");
        activity = names[key] + " · " + (states[key].detail || states[key].label);
        draw();
        return;
      }
      const description = updateActivity(event);
      if (!description) return;
      if (event.stage === "checking") set(key, { label: "Checking", tone: "info" });
      else if (event.stage === "restarting") set(key, { label: "Restarting", tone: "info" });
      else if (event.stage === "available") set(key, { label: "Updating", tone: "info" });
      activity = names[key] + " · " + description;
      if (tty) draw();
      else stream.write("  " + activity + "\n");
    },
    finish(result) {
      if (json || finished) return;
      finished = true;
      for (const key of components) set(key, describeUpdate(result[key]));
      activity = result.bridge?.status === "restart-scheduled" ? "Restarting automatically · no action needed." : "Update check complete.";
      if (tty) draw();
      else for (const key of components) stream.write("  " + names[key] + "  " + decorated(states[key]) + "\n");
      for (const key of components) {
        if (states[key].detail) stream.write("  " + names[key] + ": " + warn(states[key].detail) + "\n");
      }
      const action = updateAction(result.addon);
      if (action) stream.write("  " + warn(action) + "\n");
      if (result.bridge?.status === "restart-scheduled") stream.write("  " + muted("Bridge activation pending; Guildweaver will restart itself. No manual restart needed.") + "\n");
    },
    fail() {
      if (json || finished) return;
      finished = true;
      activity = "Update interrupted or failed. See the error below.";
      if (tty) draw();
    },
  };
}

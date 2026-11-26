import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const preferencesPath = (config) => path.join(config.dataDirectory, "notifications.json");
export function notificationsEnabled(config) {
  try { return JSON.parse(fs.readFileSync(preferencesPath(config), "utf8")).enabled !== false; }
  catch { return true; }
}
export function setNotifications(config, enabled) {
  fs.mkdirSync(config.dataDirectory, { recursive: true });
  fs.writeFileSync(preferencesPath(config), JSON.stringify({ enabled }), { mode: 0o600 });
}
export async function notify(config, title, message, { test = false, execImpl = exec, platform = process.platform } = {}) {
  if (!test && !notificationsEnabled(config)) return { status: "disabled" };
  const safeTitle = String(title).slice(0, 100);
  const safeMessage = String(message).slice(0, 300);
  try {
    if (platform === "darwin") {
      await execImpl("osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", safeTitle, safeMessage], { timeout: 10000 });
    } else if (platform === "linux") {
      await execImpl("notify-send", ["--app-name=Guildweaver", "--", safeTitle, safeMessage], { timeout: 10000 });
    } else if (platform === "win32") {
      const payload = Buffer.from(JSON.stringify([safeTitle, safeMessage])).toString("base64");
      const script = `$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] > $null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml('<toast><visual><binding template="ToastGeneric"><text/><text/></binding></visual></toast>')
$x.SelectNodes('//text').Item(0).InnerText = $p[0]
$x.SelectNodes('//text').Item(1).InnerText = $p[1]
$t = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType=WindowsRuntime]::new($x)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.Windows.PowerShell').Show($t)`;
      await execImpl("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { timeout: 10000, windowsHide: true });
    } else return { status: "unsupported" };
    return { status: "requested" };
  } catch { return { status: "unavailable" }; }
}

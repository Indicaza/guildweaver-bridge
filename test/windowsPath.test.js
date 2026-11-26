import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { registerWindowsCliPath, REGISTER_PATH_SCRIPT } from "../src/cli/windowsPath.js";

test("Windows path registration uses a literal environment argument and skips other platforms", () => {
  const directory = "C:\\Users\\A & B\\Guildweaver\\bin";
  let calls = 0;
  const exec = (file, args, options) => {
    calls++;
    assert.equal(file, "powershell.exe");
    assert.equal(args.at(-1), REGISTER_PATH_SCRIPT);
    assert.equal(options.env.GUILDWEAVER_CLI_BIN, directory);
    assert.equal(options.windowsHide, true);
  };
  assert.equal(registerWindowsCliPath(directory, { platform: "linux", exec }), false);
  assert.equal(registerWindowsCliPath(directory, { platform: "win32", exec }), true);
  assert.throws(() => registerWindowsCliPath(directory + ";C:\\Other", { platform: "win32", exec }), /Invalid/);
  assert.equal(calls, 1);
});

test("Windows registry registration preserves expandable entries and is idempotent", { skip: process.platform !== "win32" }, () => {
  const key = "Software\\GuildweaverTest-" + randomUUID();
  const directory = "C:\\Users\\A & B\\Guildweaver\\bin";
  const script = REGISTER_PATH_SCRIPT
    .replace("CreateSubKey('Environment')", "CreateSubKey('" + key + "')")
    .replace("if (-not $found) {\n    try {", "if ($false) {\n    try {");
  const fixture = "$ErrorActionPreference = 'Stop'\n" +
    "$fixture = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('" + key + "')\n" +
    "$fixture.SetValue('Path', '%SystemRoot%\\System32;C:\\Other', [Microsoft.Win32.RegistryValueKind]::ExpandString)\n" +
    "$fixture.Dispose()\ntry {\n" + script + "\n" + script + "\n" +
    "$fixture = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('" + key + "')\n" +
    "try { @{ raw = $fixture.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); kind = $fixture.GetValueKind('Path').ToString() } | ConvertTo-Json -Compress } finally { $fixture.Dispose() }\n" +
    "} finally { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('" + key + "', $false) }";
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", fixture], {
    encoding: "utf8", env: { ...process.env, GUILDWEAVER_CLI_BIN: directory }, timeout: 30000, windowsHide: true,
  });
  assert.deepEqual(JSON.parse(output), { raw: "%SystemRoot%\\System32;C:\\Other;" + directory, kind: "ExpandString" });
});

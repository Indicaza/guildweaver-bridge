import { execFileSync } from "node:child_process";

export const REGISTER_PATH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$directory = $env:GUILDWEAVER_CLI_BIN
if ([string]::IsNullOrWhiteSpace($directory) -or $directory.Contains(';') -or -not [IO.Path]::IsPathRooted($directory)) { throw 'Invalid CLI directory' }
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
    $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $wanted = [IO.Path]::GetFullPath($directory).TrimEnd([char]92, [char]47)
    $found = $false
    foreach ($entry in ($raw -split ';')) {
        $expanded = [Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"')).TrimEnd([char]92, [char]47)
        if ([string]::Equals($expanded, $wanted, [StringComparison]::OrdinalIgnoreCase)) { $found = $true; break }
    }
    if (-not $found) {
        $kind = if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
        if ($kind -ne [Microsoft.Win32.RegistryValueKind]::String -and $kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) { throw 'Unsupported user PATH registry type' }
        $next = if ([string]::IsNullOrEmpty($raw)) { $directory } else { $raw.TrimEnd(';') + ';' + $directory }
        if ($next.Length -ge 32767) { throw 'User PATH would exceed Windows environment limit' }
        $key.SetValue('Path', $next, $kind)
    }
} finally { $key.Dispose() }
if (-not $found) {
    try {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GuildweaverEnvironment {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
        $result = [UIntPtr]::Zero
        [void][GuildweaverEnvironment]::SendMessageTimeout([IntPtr]65535, 26, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$result)
    } catch {}
}
`;

export function registerWindowsCliPath(directory, { platform = process.platform, exec = execFileSync } = {}) {
  if (platform !== "win32") return false;
  if (typeof directory !== "string" || !directory || /[;\r\n\0]/.test(directory)) throw new Error("Invalid CLI PATH directory");
  exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", REGISTER_PATH_SCRIPT], {
    env: { ...process.env, GUILDWEAVER_CLI_BIN: directory }, windowsHide: true, timeout: 15000, stdio: "pipe",
  });
  return true;
}

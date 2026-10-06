//go:build windows

package main

import (
	"os/exec"
	"strings"
)

func showError(message string) {
	escaped := strings.ReplaceAll(message, "'", "''")
	command := "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('" + escaped + "','Guildweaver Installer') | Out-Null"
	_ = exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", command).Run()
}

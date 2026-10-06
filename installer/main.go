package main

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const releaseDownloadRoot = "https://github.com/Indicaza/guildweaver-bridge/releases/download"

var releaseChannel = "edge"

type releasePackage struct {
	Artifact string `json:"artifact"`
	Checksum string `json:"checksum"`
}

type releaseManifest struct {
	Packages map[string]releasePackage `json:"packages"`
}

func packageKey(goos, goarch string) (string, error) {
	switch {
	case goos == "windows" && goarch == "amd64":
		return "win32-x64", nil
	case goos == "darwin" && goarch == "amd64":
		return "darwin-x64", nil
	case goos == "darwin" && goarch == "arm64":
		return "darwin-arm64", nil
	case goos == "linux" && goarch == "amd64":
		return "linux-x64", nil
	case goos == "linux" && goarch == "arm64":
		return "linux-arm64", nil
	default:
		return "", fmt.Errorf("unsupported platform: %s-%s", goos, goarch)
	}
}

func parseChecksum(value string) (string, error) {
	fields := strings.Fields(strings.TrimSpace(value))
	if len(fields) == 0 || len(fields[0]) != 64 {
		return "", errors.New("release checksum was invalid")
	}
	if _, err := hex.DecodeString(fields[0]); err != nil {
		return "", errors.New("release checksum was invalid")
	}
	return strings.ToLower(fields[0]), nil
}

func download(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

func verifySHA256(payload []byte, expected string) error {
	sum := sha256.Sum256(payload)
	actual := hex.EncodeToString(sum[:])
	if actual != expected {
		return errors.New("download checksum did not match")
	}
	return nil
}

func unzipArchive(archivePath, destination string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer reader.Close()

	cleanDestination := filepath.Clean(destination) + string(os.PathSeparator)
	for _, file := range reader.File {
		target := filepath.Join(destination, file.Name)
		cleanTarget := filepath.Clean(target)
		if !strings.HasPrefix(cleanTarget+string(os.PathSeparator), cleanDestination) {
			return errors.New("release archive contained an unsafe path")
		}

		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(cleanTarget, 0o755); err != nil {
				return err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(cleanTarget), 0o755); err != nil {
			return err
		}
		input, err := file.Open()
		if err != nil {
			return err
		}
		mode := file.Mode()
		if mode == 0 {
			mode = 0o644
		}
		output, err := os.OpenFile(cleanTarget, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
		if err != nil {
			input.Close()
			return err
		}
		_, copyErr := io.Copy(output, input)
		closeOutErr := output.Close()
		closeInErr := input.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeOutErr != nil {
			return closeOutErr
		}
		if closeInErr != nil {
			return closeInErr
		}
	}
	return nil
}

func runInstaller(ctx context.Context, client *http.Client, log io.Writer) error {
	key, err := packageKey(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return err
	}

	base := fmt.Sprintf("%s/%s", releaseDownloadRoot, releaseChannel)
	manifestBytes, err := download(ctx, client, base+"/release.json")
	if err != nil {
		return fmt.Errorf("load release metadata: %w", err)
	}

	var manifest releaseManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return fmt.Errorf("parse release metadata: %w", err)
	}
	packageInfo, ok := manifest.Packages[key]
	if !ok || packageInfo.Artifact == "" || packageInfo.Checksum == "" {
		return fmt.Errorf("release does not include package %s", key)
	}

	fmt.Fprintf(log, "Downloading Guildweaver for %s...\n", key)
	checksumBytes, err := download(ctx, client, base+"/"+packageInfo.Checksum)
	if err != nil {
		return fmt.Errorf("download checksum: %w", err)
	}
	expectedChecksum, err := parseChecksum(string(checksumBytes))
	if err != nil {
		return err
	}

	archiveBytes, err := download(ctx, client, base+"/"+packageInfo.Artifact)
	if err != nil {
		return fmt.Errorf("download bridge: %w", err)
	}
	if err := verifySHA256(archiveBytes, expectedChecksum); err != nil {
		return err
	}

	workdir, err := os.MkdirTemp("", "guildweaver-installer-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(workdir)

	archivePath := filepath.Join(workdir, "GuildweaverBridge.zip")
	if err := os.WriteFile(archivePath, archiveBytes, 0o600); err != nil {
		return err
	}
	extractRoot := filepath.Join(workdir, "bridge")
	if err := os.MkdirAll(extractRoot, 0o755); err != nil {
		return err
	}
	if err := unzipArchive(archivePath, extractRoot); err != nil {
		return fmt.Errorf("extract bridge: %w", err)
	}

	packageRoot := filepath.Join(extractRoot, "GuildweaverBridge")
	nodeName := "node"
	if runtime.GOOS == "windows" {
		nodeName = "node.exe"
	}
	nodePath := filepath.Join(packageRoot, nodeName)
	cliPath := filepath.Join(packageRoot, "app", "src", "cli.js")
	if runtime.GOOS != "windows" {
		_ = os.Chmod(nodePath, 0o755)
	}
	if _, err := os.Stat(nodePath); err != nil {
		return errors.New("downloaded bridge package is missing its runtime")
	}
	if _, err := os.Stat(cliPath); err != nil {
		return errors.New("downloaded bridge package is missing its installer")
	}

	fmt.Fprintln(log, "Installing Guildweaver...")
	cmd := exec.CommandContext(ctx, nodePath, cliPath, "install-package")
	cmd.Dir = packageRoot
	cmd.Env = os.Environ()
	cmd.Stdout = log
	cmd.Stderr = log
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("Guildweaver setup failed: %w", err)
	}
	fmt.Fprintln(log, "Guildweaver installation complete.")
	return nil
}

func main() {
	logPath := filepath.Join(os.TempDir(), "GuildweaverInstaller.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		showError("Guildweaver could not start its installer log.")
		os.Exit(1)
	}
	defer logFile.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	client := &http.Client{Timeout: 2 * time.Minute}

	if err := runInstaller(ctx, client, logFile); err != nil {
		fmt.Fprintf(logFile, "ERROR: %v\n", err)
		_ = logFile.Sync()
		showError(fmt.Sprintf("Guildweaver could not be installed.\n\n%s\n\nInstaller log: %s", err, logPath))
		os.Exit(1)
	}
}

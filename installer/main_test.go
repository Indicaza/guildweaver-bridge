package main

import "testing"

func TestPackageKey(t *testing.T) {
	tests := []struct {
		goos   string
		goarch string
		want   string
	}{
		{"windows", "amd64", "win32-x64"},
		{"darwin", "amd64", "darwin-x64"},
		{"darwin", "arm64", "darwin-arm64"},
		{"linux", "amd64", "linux-x64"},
		{"linux", "arm64", "linux-arm64"},
	}

	for _, test := range tests {
		got, err := packageKey(test.goos, test.goarch)
		if err != nil {
			t.Fatalf("packageKey(%q, %q): %v", test.goos, test.goarch, err)
		}
		if got != test.want {
			t.Fatalf("packageKey(%q, %q) = %q, want %q", test.goos, test.goarch, got, test.want)
		}
	}

	if _, err := packageKey("darwin", "386"); err == nil {
		t.Fatal("expected unsupported architecture error")
	}
}

func TestParseChecksum(t *testing.T) {
	const checksum = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

	got, err := parseChecksum(checksum + "  GuildweaverBridge.zip\n")
	if err != nil {
		t.Fatalf("parseChecksum: %v", err)
	}
	if got != checksum {
		t.Fatalf("parseChecksum = %q, want %q", got, checksum)
	}

	if _, err := parseChecksum("not-a-checksum"); err == nil {
		t.Fatal("expected invalid checksum error")
	}
}

func TestVerifySHA256(t *testing.T) {
	const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if err := verifySHA256([]byte("abc"), expected); err != nil {
		t.Fatalf("verifySHA256: %v", err)
	}
	if err := verifySHA256([]byte("wrong"), expected); err == nil {
		t.Fatal("expected checksum mismatch")
	}
}

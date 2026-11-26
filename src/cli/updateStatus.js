const STATUSES = {
  current: ["Up to date", "success"],
  "package-current": ["Up to date", "success"],
  "developer-current": ["Up to date", "success"],
  updated: ["Updated", "success"],
  "developer-updated": ["Updated", "success"],
  "restart-scheduled": ["Restarting", "info"],
  "release-unavailable": ["Unavailable", "warning", "Release unavailable. Check again later."],
  "not-packaged": ["Unavailable", "warning", "Automatic updates are unavailable for this installation."],
  "package-not-installed": ["Unavailable", "warning", "Bridge is not installed as a managed package."],
  dirty: ["Skipped", "warning", "Local changes preserved."],
  "developer-dirty": ["Skipped", "warning", "Local changes preserved."],
  branch: ["Skipped", "warning", "Non-main branch preserved."],
  "developer-branch": ["Skipped", "warning", "Non-main branch preserved."],
  failed: ["Failed", "error"],
};

export function describeUpdate(result) {
  const [label, tone, detail] = STATUSES[result?.status] || ["Unavailable", "warning", "Update status unavailable."];
  return { label, tone, ...(detail ? { detail } : {}) };
}

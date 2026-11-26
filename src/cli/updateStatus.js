const LABELS = {
  current: "Up to date",
  "package-current": "Up to date",
  "developer-current": "Up to date",
  updated: "Updated",
  "developer-updated": "Updated",
  "restart-scheduled": "Update ready · restarting automatically",
  "release-unavailable": "Release unavailable · check again later",
  "not-packaged": "Automatic update unavailable",
  "package-not-installed": "Not installed as a managed package",
  dirty: "Skipped · local changes",
  "developer-dirty": "Skipped · local changes",
  branch: "Skipped · non-main branch",
  "developer-branch": "Skipped · non-main branch",
  failed: "Update failed",
};

export function describeUpdate(result) {
  const label = LABELS[result?.status] || "Update status unavailable";
  const version = result?.releaseVersion || (result?.commit ? String(result.commit).slice(0, 8) : "");
  const tone = ["current", "package-current", "developer-current", "updated", "developer-updated"].includes(result?.status) ? "success"
    : result?.status === "failed" ? "error" : result?.status === "restart-scheduled" ? "info" : "warning";
  return { label: version ? label + " · " + version : label, tone };
}

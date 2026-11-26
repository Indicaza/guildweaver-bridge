const CURRENT = new Set(["current", "package-current", "developer-current", "updated", "developer-updated"]);
const DETAILS = {
  "release-unavailable": "Release unavailable. Check again later.",
  "not-packaged": "Automatic updates are unavailable for this installation.",
  "package-not-installed": "Bridge is not installed as a managed package.",
  dirty: "Local changes preserved.",
  "developer-dirty": "Local changes preserved.",
  branch: "Non-main branch preserved.",
  "developer-branch": "Non-main branch preserved.",
};
export function describeUpdate(result) {
  if (CURRENT.has(result?.status)) return { label: "Current", tone: "success" };
  if (result?.status === "restart-scheduled") return { label: "Updating", tone: "info" };
  const detail = result?.detail || DETAILS[result?.status] || (result?.status === "failed" ? "" : "Update status unavailable.");
  return { label: "Failed", tone: "error", ...(detail ? { detail } : {}) };
}

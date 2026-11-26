import path from "node:path";

function releaseValidationError(database) {
  const validation = database?.meta?.releaseValidation;
  const reason = typeof validation?.reason === "string"
    ? validation.reason.replace(/[^a-z_]/g, "").slice(0, 64) : "";
  return reason && reason !== "live"
    ? `Forever live release not confirmed (${reason}); run /gw version in WoW for details.`
    : "Forever live release marker missing; check the installed addon and run /gw version in WoW.";
}

export function releaseIssue(database, filePath) {
  if (database.gameRelease !== "forever-live") {
    return releaseValidationError(database);
  }
  const validation = database.meta?.releaseValidation;
  if (validation?.reason === "live_realm_unavailable") {
    const parts = path.resolve(filePath).split(path.sep);
    if (!parts.some((part) => part.toLowerCase() === "_forever_")
        || parts.some((part) => /^_(beta|ptr|classic_beta|classic_ptr)_$/i.test(part))
        || !Number.isInteger(Number(validation.interface))
        || Number(validation.interface) < 16000 || Number(validation.interface) >= 17000
        || !Number.isFinite(Number(validation.build)) || Number(validation.build) < 71037
        || validation.testBuild === true || validation.testBuild === 1) {
      return "Realm-free telemetry requires the supported live Forever installation and build";
    }
  }
  return null;
}

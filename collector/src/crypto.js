import crypto from "node:crypto";

export function opaqueToken(prefix) {
  return `${prefix}_${crypto.randomBytes(32).toString("base64url")}`;
}

export function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function identifier(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

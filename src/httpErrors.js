export function httpErrorDetail(status, body, raw = "") {
  const error = typeof body?.error === "string" ? body.error.trim() : "";
  if (error && /^[a-zA-Z0-9_.: -]{1,160}$/.test(error)) return error;
  if (typeof raw === "string" && /<(!doctype|html|head|body|script)\b/i.test(raw)) return "HTTP " + status + " (HTML gateway response)";
  return "HTTP " + status;
}

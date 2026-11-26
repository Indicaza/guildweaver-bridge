import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { readCredentials } from "./pairing.js";

const DATASETS = new Set(["market-current", "market-monthly"]);

function parseOptions(args) {
  const options = {};
  const allowed = new Set(["--dataset", "--market", "--out", "--cursor", "--config"]);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!allowed.has(key) || Object.hasOwn(options, key) || !value || value.startsWith("--")) {
      throw new Error("Invalid archive option: " + key);
    }
    options[key] = value;
  }
  return options;
}

async function archiveRequest(config, credentials, route, fetchImpl) {
  const response = await fetchImpl(config.holdfastUrl + "/api/bridge/archive/" + route, {
    headers: { Authorization: "Bearer " + credentials.deviceToken },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Archive request failed (HTTP " + response.status + "). Check device access in the admin console.");
  return response.json();
}

export async function runArchiveCommand(config, args, { fetchImpl = fetch, log = console.log } = {}) {
  const command = args[0];
  if (command !== "status" && command !== "pull") {
    throw new Error("Use archive status or archive pull --dataset DATASET --market KEY --out FILE.json.gz");
  }
  const options = parseOptions(args.slice(1));
  if (command === "status" && Object.keys(options).some((key) => key !== "--config")) {
    throw new Error("Archive status does not accept export options");
  }
  const credentials = readCredentials(config.credentialsPath);
  if (!credentials) throw new Error("Pair this computer first, then authorize it in the Guildweaver admin console.");
  if (command === "status") {
    const result = await archiveRequest(config, credentials, "status", fetchImpl);
    log(JSON.stringify(result, null, 2));
    return result;
  }
  const dataset = options["--dataset"];
  const market = options["--market"];
  const output = options["--out"];
  const cursor = options["--cursor"] ?? null;
  if (!DATASETS.has(dataset) || !market || !output || !output.endsWith(".json.gz")) {
    throw new Error("Specify a supported --dataset, --market and explicit --out FILE.json.gz");
  }
  const destination = path.resolve(output);
  if (fs.existsSync(destination)) throw new Error("Archive file already exists: " + destination);
  if (!fs.statSync(path.dirname(destination)).isDirectory()) throw new Error("Output directory must already exist");
  const params = new URLSearchParams({ dataset, market });
  if (cursor !== null) params.set("cursor", cursor);
  const result = await archiveRequest(config, credentials, "batch?" + params, fetchImpl);
  const batch = result?.batch;
  if (!batch || batch.schemaVersion !== 1 || batch.dataset !== dataset || batch.market !== market ||
      batch.cursor !== cursor || !Array.isArray(batch.rows) || batch.rows.length > 200 ||
      (batch.nextCursor !== null && typeof batch.nextCursor !== "string")) {
    throw new Error("Unexpected archive batch; nothing saved");
  }
  const digest = createHash("sha256").update(JSON.stringify(batch)).digest("hex");
  if (result.sha256 !== digest) throw new Error("Archive checksum mismatch; nothing saved");
  const compressed = gzipSync(JSON.stringify(result));
  let fd;
  try {
    fd = fs.openSync(destination, "wx", 0o600);
    fs.writeFileSync(fd, compressed);
    fs.fsyncSync(fd);
  } catch (error) {
    if (fd !== undefined) {
      fs.closeSync(fd);
      fd = undefined;
      fs.rmSync(destination, { force: true });
    }
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  log(JSON.stringify({ file: destination, rows: batch.rows.length, sha256: digest, nextCursor: batch.nextCursor }, null, 2));
  return result;
}

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { readCredentials } from "./pairing.js";
import { archiveHttp, queuedArchivePage } from "./archiveTransport.js";

const DATASETS = new Set(["market-current", "market-monthly"]);
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_PAGES_PER_RUN = 10_000;

function parseOptions(args) {
  const options = {};
  const allowed = new Set(["--dataset", "--market", "--out", "--dir", "--cursor", "--config"]);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!allowed.has(key) || Object.hasOwn(options, key) || !value || value.startsWith("--")) throw new Error("Invalid archive option: " + key);
    options[key] = value;
  }
  return options;
}

function verifyBatch(result, { dataset, market, cursor }) {
  const batch = result?.batch;
  if (!batch || batch.schemaVersion !== 1 || batch.dataset !== dataset || batch.market !== market ||
      batch.cursor !== cursor || !Array.isArray(batch.rows) || batch.rows.length > 200 ||
      (batch.nextCursor !== null && (typeof batch.nextCursor !== "string" || !batch.nextCursor || batch.nextCursor.length > 2048 || batch.nextCursor === cursor || !batch.rows.length))) {
    throw new Error("Unexpected archive batch; nothing saved");
  }
  const digest = createHash("sha256").update(JSON.stringify(batch)).digest("hex");
  if (result.sha256 !== digest) throw new Error("Archive checksum mismatch; nothing saved");
  return batch;
}

function writeNewFile(destination, bytes) {
  const temporary = destination + ".partial-" + randomUUID();
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.linkSync(temporary, destination);
    // Directory fsync is not available on every desktop filesystem.
    try { const directory = fs.openSync(path.dirname(destination), "r"); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); } } catch {}
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
}

function readPage(file) {
  if (fs.statSync(file).size > MAX_PAGE_BYTES) throw new Error("Archive page exceeds its size limit: " + file);
  return JSON.parse(gunzipSync(fs.readFileSync(file), { maxOutputLength: MAX_PAGE_BYTES }).toString("utf8"));
}

const batchName = (page) => "batch-" + String(page).padStart(6, "0") + ".json.gz";

function openArchiveDirectory(directory, dataset, market, holdfastUrl) {
  fs.mkdirSync(directory, { recursive: true });
  const descriptor = path.join(directory, "archive.json");
  const wanted = { schemaVersion: 1, dataset, market, website: holdfastUrl };
  if (!fs.existsSync(descriptor)) {
    if (fs.readdirSync(directory).length) throw new Error("Choose an empty archive directory or one with a matching archive.json");
    writeNewFile(descriptor, Buffer.from(JSON.stringify(wanted, null, 2)));
  }
  const existing = JSON.parse(fs.readFileSync(descriptor, "utf8"));
  if (existing.schemaVersion !== 1 || existing.dataset !== dataset || existing.market !== market || existing.website !== holdfastUrl) {
    throw new Error("Archive directory belongs to another dataset, market or website");
  }
  return wanted;
}

function scanArchive(directory, descriptor) {
  const files = fs.readdirSync(directory).filter(name => /^batch-\d{6}\.json\.gz$/.test(name)).sort();
  let cursor = null, rows = 0, bytes = 0, complete = false;
  const cursors = new Set();
  for (const [index, name] of files.entries()) {
    if (complete || name !== batchName(index + 1)) throw new Error("Archive batch chain has an unexpected gap or trailing page: " + name);
    const file = path.join(directory, name);
    const result = readPage(file);
    const batch = verifyBatch(result, { ...descriptor, cursor });
    if (batch.nextCursor !== null && cursors.has(batch.nextCursor)) throw new Error("Archive cursor cycle");
    cursors.add(batch.nextCursor);
    cursor = batch.nextCursor;
    complete = cursor === null;
    rows += batch.rows.length;
    bytes += fs.statSync(file).size;
  }
  return { pages: files.length, cursor, rows, bytes, complete, cursors };
}

export async function runArchiveCommand(config, args, { fetchImpl = fetch, log = console.log, progress = () => {}, signal, sleepImpl, now, random } = {}) {
  const command = args[0];
  if (!["status", "pull", "verify"].includes(command)) throw new Error("Use archive status, archive pull --dataset DATASET --market KEY --dir DIRECTORY, or archive verify --dir DIRECTORY");
  const options = parseOptions(args.slice(1));
  if (command === "verify") {
    if (!options["--dir"] || Object.keys(options).some(key => !["--dir", "--config"].includes(key))) throw new Error("Use archive verify --dir DIRECTORY");
    const directory = path.resolve(options["--dir"]);
    const descriptor = JSON.parse(fs.readFileSync(path.join(directory, "archive.json"), "utf8"));
    if (descriptor.schemaVersion !== 1 || !DATASETS.has(descriptor.dataset) || typeof descriptor.market !== "string") throw new Error("Invalid archive descriptor");
    const { cursors, ...report } = scanArchive(directory, descriptor);
    log(JSON.stringify({ directory, dataset: descriptor.dataset, market: descriptor.market, ...report }, null, 2));
    return report;
  }

  if (command === "status" && Object.keys(options).some(key => key !== "--config")) throw new Error("Archive status does not accept export options");
  const credentials = readCredentials(config.credentialsPath);
  if (!credentials) throw new Error("Pair this computer first, then authorize it in the Guildweaver admin console.");
  if (command === "status") {
    const { response, data } = await archiveHttp(config, credentials, "status", { fetchImpl, signal });
    if (!response.ok) throw new Error("Archive status failed (HTTP " + response.status + ")");
    log(JSON.stringify(data, null, 2));
    return data;
  }

  const dataset = options["--dataset"], market = options["--market"], output = options["--out"], dir = options["--dir"];
  const cursor = options["--cursor"] ?? null;
  if (!DATASETS.has(dataset) || !market || market.length > 256 || Boolean(output) === Boolean(dir) ||
      (output && !output.endsWith(".json.gz")) || (dir && cursor !== null)) {
    throw new Error("Specify a supported --dataset, --market and explicit --out FILE.json.gz or --dir DIRECTORY (no --cursor with --dir)");
  }
  const transportOptions = { fetchImpl, signal, sleepImpl, now, random, progress };

  if (output) {
    const destination = path.resolve(output);
    if (fs.existsSync(destination)) throw new Error("Archive file already exists: " + destination);
    if (!fs.statSync(path.dirname(destination)).isDirectory()) throw new Error("Output directory must already exist");
    const { result, release } = await queuedArchivePage(config, credentials, { dataset, market, ...(cursor === null ? {} : { cursor }) }, transportOptions);
    try {
      const batch = verifyBatch(result, { dataset, market, cursor });
      progress({ stage: "verified" });
      const compressed = gzipSync(JSON.stringify(result));
      writeNewFile(destination, compressed);
      progress({ stage: "saved", pages: 1, rows: batch.rows.length, bytes: compressed.length });
      log(JSON.stringify({ file: destination, rows: batch.rows.length, sha256: result.sha256, nextCursor: batch.nextCursor }, null, 2));
      return result;
    } finally { await release(); }
  }

  const directory = path.resolve(dir);
  const descriptor = openArchiveDirectory(directory, dataset, market, config.holdfastUrl);
  const state = scanArchive(directory, descriptor);
  progress({ stage: "resume", pages: state.pages, rows: state.rows, bytes: state.bytes });
  for (let index = 0; !state.complete && index < MAX_PAGES_PER_RUN; index++) {
    signal?.throwIfAborted();
    const page = state.pages + 1;
    const { result, release } = await queuedArchivePage(config, credentials, {
      dataset, market, ...(state.cursor === null ? {} : { cursor: state.cursor }),
    }, { ...transportOptions, progress: event => progress({ ...event, page, pages: state.pages, rows: state.rows, bytes: state.bytes }) });
    try {
      const batch = verifyBatch(result, { dataset, market, cursor: state.cursor });
      if (batch.nextCursor !== null && state.cursors.has(batch.nextCursor)) throw new Error("Archive cursor cycle");
      progress({ stage: "verified", page });
      const compressed = gzipSync(JSON.stringify(result));
      writeNewFile(path.join(directory, batchName(page)), compressed);
      state.cursors.add(batch.nextCursor);
      state.cursor = batch.nextCursor;
      state.complete = state.cursor === null;
      state.pages++;
      state.rows += batch.rows.length;
      state.bytes += compressed.length;
      progress({ stage: "saved", pages: state.pages, rows: state.rows, bytes: state.bytes });
    } finally { await release(); }
  }
  const { cursors, ...report } = state;
  progress({ stage: state.complete ? "complete" : "paused", ...report });
  log(JSON.stringify({ directory, dataset, market, ...report }, null, 2));
  return report;
}

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { readCredentials } from "./pairing.js";
import { archiveHttp, queuedArchivePage } from "./archiveTransport.js";

const HELD_DATASETS = ["market-current", "market-hourly", "market-daily", "market-weekly", "market-monthly-all"];
const DATASETS = new Set([...HELD_DATASETS, "market-monthly"]);
const validHold = id => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id);
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_PAGES_PER_RUN = 10_000;

function parseOptions(args) {
  const options = {};
  const allowed = new Set(["--dataset", "--market", "--out", "--dir", "--cursor", "--hold", "--config"]);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!allowed.has(key) || Object.hasOwn(options, key) || !value || value.startsWith("--")) throw new Error("Invalid archive option: " + key);
    options[key] = value;
  }
  return options;
}

function verifyBatch(result, { dataset, market, cursor, holdId }) {
  const batch = result?.batch;
  if (!batch || batch.schemaVersion !== 1 || batch.dataset !== dataset || batch.market !== market ||
      batch.cursor !== cursor || (batch.holdId ?? null) !== (holdId ?? null) || !Array.isArray(batch.rows) || batch.rows.length > (holdId ? 1000 : 200) ||
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

function openArchiveDirectory(directory, dataset, market, holdfastUrl, holdId) {
  fs.mkdirSync(directory, { recursive: true });
  const descriptor = path.join(directory, "archive.json");
  const wanted = { schemaVersion: 1, dataset, market, website: holdfastUrl, ...(holdId ? { holdId } : {}) };
  if (!fs.existsSync(descriptor)) {
    if (fs.readdirSync(directory).length) throw new Error("Choose an empty archive directory or one with a matching archive.json");
    writeNewFile(descriptor, Buffer.from(JSON.stringify(wanted, null, 2)));
  }
  const existing = JSON.parse(fs.readFileSync(descriptor, "utf8"));
  if (existing.schemaVersion !== 1 || existing.dataset !== dataset || existing.market !== market || existing.website !== holdfastUrl || (existing.holdId ?? null) !== (holdId ?? null)) {
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
  if (!["status", "pull", "verify", "pull-all", "verify-all"].includes(command)) throw new Error("Use archive status, pull, verify, pull-all or verify-all");
  const options = parseOptions(args.slice(1));
  if (command === "verify-all") {
    if (!options["--dir"] || Object.keys(options).some(key => !["--dir", "--config"].includes(key))) throw new Error("Use archive verify-all --dir DIRECTORY");
    const report = verifyTransfer(path.resolve(options["--dir"]));
    log(JSON.stringify(report, null, 2));
    return report;
  }
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

  if (command === "pull-all") {
    if (!options["--dir"] || Object.keys(options).some(key => !["--dir", "--config"].includes(key))) throw new Error("Use archive pull-all --dir DIRECTORY");
    const directory = path.resolve(options["--dir"]);
    const status = await readTransferStatus(config, credentials, { fetchImpl, signal });
    const plan = openTransfer(directory, config.holdfastUrl, status);
    for (const [index, entry] of plan.entries.entries()) {
      signal?.throwIfAborted();
      progress({ stage: "dataset", index: index + 1, total: plan.entries.length, dataset: entry.dataset, market: entry.market });
      const report = await runArchiveCommand(config, ["pull", "--dataset", entry.dataset, "--market", entry.market, "--hold", plan.holdId, "--dir", path.join(directory, entry.directory)], {
        fetchImpl, signal, sleepImpl, now, random, progress, log: () => {},
      });
      if (!report.complete) {
        const partial = verifyTransfer(directory);
        log(JSON.stringify(partial, null, 2));
        return partial;
      }
    }
    const final = await readTransferStatus(config, credentials, { fetchImpl, signal });
    if (JSON.stringify(transferPlan(config.holdfastUrl, final)) !== JSON.stringify(plan)) throw new Error("Archive hold or market list changed; transfer cannot be certified.");
    const report = verifyTransfer(directory);
    log(JSON.stringify(report, null, 2));
    return report;
  }

  const dataset = options["--dataset"], market = options["--market"], output = options["--out"], dir = options["--dir"];
  const cursor = options["--cursor"] ?? null;
  const holdId = options["--hold"];
  if ((holdId && !validHold(holdId)) || (HELD_DATASETS.includes(dataset) && dataset !== "market-current" && !holdId)) throw new Error("Start an archive hold and specify its ID with --hold.");
  const held = holdId ? { holdId } : {};
  if (!DATASETS.has(dataset) || !market || market.length > 256 || Boolean(output) === Boolean(dir) ||
      (output && !output.endsWith(".json.gz")) || (dir && cursor !== null)) {
    throw new Error("Specify a supported --dataset, --market and explicit --out FILE.json.gz or --dir DIRECTORY (no --cursor with --dir)");
  }
  const transportOptions = { fetchImpl, signal, sleepImpl, now, random, progress };

  if (output) {
    const destination = path.resolve(output);
    if (fs.existsSync(destination)) throw new Error("Archive file already exists: " + destination);
    if (!fs.statSync(path.dirname(destination)).isDirectory()) throw new Error("Output directory must already exist");
    const { result, release } = await queuedArchivePage(config, credentials, { dataset, market, ...held, ...(cursor === null ? {} : { cursor }) }, transportOptions);
    try {
      const batch = verifyBatch(result, { dataset, market, cursor, ...held });
      progress({ stage: "verified" });
      const compressed = gzipSync(JSON.stringify(result));
      writeNewFile(destination, compressed);
      progress({ stage: "saved", pages: 1, rows: batch.rows.length, bytes: compressed.length });
      log(JSON.stringify({ file: destination, rows: batch.rows.length, sha256: result.sha256, nextCursor: batch.nextCursor }, null, 2));
      return result;
    } finally { await release(); }
  }

  const directory = path.resolve(dir);
  const descriptor = openArchiveDirectory(directory, dataset, market, config.holdfastUrl, holdId);
  const state = scanArchive(directory, descriptor);
  progress({ stage: "resume", pages: state.pages, rows: state.rows, bytes: state.bytes });
  for (let index = 0; !state.complete && index < MAX_PAGES_PER_RUN; index++) {
    signal?.throwIfAborted();
    const page = state.pages + 1;
    const { result, release } = await queuedArchivePage(config, credentials, {
      dataset, market, ...held, ...(state.cursor === null ? {} : { cursor: state.cursor }),
    }, { ...transportOptions, progress: event => progress({ ...event, page, pages: state.pages, rows: state.rows, bytes: state.bytes }) });
    try {
      const batch = verifyBatch(result, { dataset, market, cursor: state.cursor, ...held });
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

async function readTransferStatus(config, credentials, options) {
  const { response, data } = await archiveHttp(config, credentials, "status", options);
  if (!response.ok) throw new Error("Cannot check archive hold (HTTP " + response.status + ")");
  return data;
}

function transferPlan(website, status) {
  if (!status?.enabled || !validHold(status.hold?.id)) throw new Error("Authorize this device and start an archive hold first.");
  if (status.marketsTruncated !== false || !Array.isArray(status.markets) || !Array.isArray(status.datasets) ||
      !HELD_DATASETS.every(dataset => status.datasets.includes(dataset))) throw new Error("The website does not advertise complete held history support.");
  const markets = status.markets.map(market => market.key);
  if (markets.some(key => typeof key !== "string" || !key || key.length > 256) || new Set(markets).size !== markets.length) throw new Error("Invalid market list");
  const entries = markets.sort().flatMap(market => HELD_DATASETS.map(dataset => ({
    market, dataset, directory: market.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) + "-" + createHash("sha256").update(market).digest("hex").slice(0, 16) + "/" + dataset,
  })));
  return { schemaVersion: 1, website, holdId: status.hold.id, entries };
}

function openTransfer(directory, website, status) {
  const plan = transferPlan(website, status);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "transfer.json");
  if (!fs.existsSync(file)) {
    if (fs.readdirSync(directory).length) throw new Error("Choose an empty directory for the transfer.");
    writeNewFile(file, Buffer.from(JSON.stringify(plan, null, 2)));
  }
  const existing = JSON.parse(fs.readFileSync(file, "utf8"));
  if (JSON.stringify(existing) !== JSON.stringify(plan)) throw new Error("Transfer directory belongs to another website, hold or market list.");
  return plan;
}

function verifyTransfer(directory) {
  const plan = JSON.parse(fs.readFileSync(path.join(directory, "transfer.json"), "utf8"));
  if (plan.schemaVersion !== 1 || typeof plan.website !== "string" || !validHold(plan.holdId) || !Array.isArray(plan.entries)) throw new Error("Invalid transfer plan");
  const markets = [...new Set(plan.entries.map(entry => entry.market))].map(key => ({ key }));
  const expected = transferPlan(plan.website, { enabled: true, hold: { id: plan.holdId }, markets, marketsTruncated: false, datasets: HELD_DATASETS });
  if (JSON.stringify(expected) !== JSON.stringify(plan)) throw new Error("Invalid transfer plan entries");
  let complete = 0, pages = 0, rows = 0, bytes = 0;
  const pending = [];
  for (const entry of plan.entries) {
    const sub = path.join(directory, entry.directory);
    const file = path.join(sub, "archive.json");
    if (!fs.existsSync(file)) { pending.push(entry.directory); continue; }
    const descriptor = JSON.parse(fs.readFileSync(file, "utf8"));
    if (descriptor.schemaVersion !== 1 || descriptor.website !== plan.website || descriptor.holdId !== plan.holdId || descriptor.dataset !== entry.dataset || descriptor.market !== entry.market) throw new Error("Archive descriptor does not match transfer plan: " + entry.directory);
    const report = scanArchive(sub, descriptor);
    pages += report.pages; rows += report.rows; bytes += report.bytes;
    if (report.complete) complete++; else pending.push(entry.directory);
  }
  return { directory, holdId: plan.holdId, datasetsComplete: complete, datasetsTotal: plan.entries.length, pages, rows, bytes, complete: pending.length === 0, pending };
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeTelemetryRecord, telemetryIdempotencyKey } from '../src/telemetry.js';
import { syncOnce } from '../src/sync.js';

// auction_scan travels like every other event: the bridge does not read
// prices or markets, it moves the payload and keeps delivery idempotent.
const envelope = JSON.parse(fs.readFileSync(new URL('../fixtures/telemetry/auction_scan.v1.json', import.meta.url), 'utf8'));
const streamKey = `auction_scan:character-rook:${envelope.payload.scanId}`;

function lua(value) {
  if (value == null) return 'nil';
  if (Array.isArray(value)) return `{${value.map(lua).join(',')}}`;
  if (typeof value === 'object') return `{${Object.entries(value).map(([key, entry]) => `[${JSON.stringify(key)}]=${lua(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

test('forwards an auction scan unchanged, price points included', () => {
  const record = normalizeTelemetryRecord(streamKey, { kind: 'event', revision: 1, envelope });
  assert.equal(record.envelope.eventType, 'auction_scan');
  assert.deepEqual(record.envelope.payload, envelope.payload);
  assert.equal(telemetryIdempotencyKey(record),
    telemetryIdempotencyKey(normalizeTelemetryRecord(streamKey, { kind: 'event', revision: 1, envelope: structuredClone(envelope) })));
});

test('a scan read from SavedVariables keeps nested price arrays and is sent once', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gw auction '));
  const savedVariablesPath = path.join(directory, 'SavedVariables', 'Guildweaver.lua');
  fs.mkdirSync(path.dirname(savedVariablesPath), { recursive: true });
  fs.writeFileSync(savedVariablesPath, `GuildweaverDB = ${lua({ gameRelease: 'forever-live', schemaVersion: 4, sync: { outbound: { telemetry: {
    [streamKey]: { kind: 'event', revision: 1, envelope },
  } } } })}`);
  const config = { holdfastUrl: 'https://holdfast.example', telemetryEndpoint: 'https://collector.example/telemetry',
    deviceToken: 'test-device', savedVariablesPath, wowRoot: null, questSyncIntervalMs: Number.MAX_SAFE_INTEGER,
    statePath: path.join(directory, 'state.json') };
  let online = false;
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push({ body: JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
    return new Response(JSON.stringify({ status: 'accepted' }), { status: online ? 200 : 503 });
  };
  try {
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetryFailed, 1);
    online = true;
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 1);
    assert.equal(requests[0].key, requests[1].key, 'a retry reuses the idempotency key');
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 0, 'delivered once');
    const sent = requests.at(-1).body.envelope.payload;
    assert.deepEqual(sent.items[0].prices, [[12, 240, 2], [15, 20, 1], [999, 1, 1]]);
    assert.equal(sent.items[1].suffix, -1081);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

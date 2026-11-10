import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeTelemetryRecord, telemetryIdempotencyKey } from '../src/telemetry.js';
import { syncOnce } from '../src/sync.js';

// dungeon_run is carried like every other event: the bridge does not read
// the payload, it only moves it and keeps delivery idempotent.
const envelope = JSON.parse(fs.readFileSync(new URL('../fixtures/telemetry/dungeon_run.v1.json', import.meta.url), 'utf8'));
const streamKey = `dungeon_run:character-rook:${envelope.payload.runId}`;

function lua(value) {
  if (value == null) return 'nil';
  if (Array.isArray(value)) return `{${value.map(lua).join(',')}}`;
  if (typeof value === 'object') return `{${Object.entries(value).map(([key, entry]) => `[${JSON.stringify(key)}]=${lua(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

test('forwards a dungeon run payload unchanged', () => {
  const record = normalizeTelemetryRecord(streamKey, { kind: 'event', revision: 3, envelope });
  assert.equal(record.kind, 'event');
  assert.equal(record.envelope.eventType, 'dungeon_run');
  assert.deepEqual(record.envelope.payload, envelope.payload);
  const open = normalizeTelemetryRecord(streamKey, { kind: 'event', revision: 2,
    envelope: { ...envelope, payload: { ...envelope.payload, sequence: 2, status: 'open' } } });
  assert.notEqual(telemetryIdempotencyKey(record), telemetryIdempotencyKey(open));
  assert.equal(telemetryIdempotencyKey(record), telemetryIdempotencyKey(
    normalizeTelemetryRecord(streamKey, { kind: 'event', revision: 3, envelope: structuredClone(envelope) })));
});

test('retries an open run unchanged, then sends the final run once', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gw dungeon '));
  const savedVariablesPath = path.join(directory, 'SavedVariables', 'Guildweaver.lua');
  fs.mkdirSync(path.dirname(savedVariablesPath), { recursive: true });
  function write(revision, current) {
    fs.writeFileSync(savedVariablesPath, `GuildweaverDB = ${lua({ gameRelease: 'forever-live', schemaVersion: 4, sync: { outbound: { telemetry: {
      [streamKey]: { kind: 'event', revision, envelope: current },
    } } } })}`);
  }
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
    write(1, { ...envelope, payload: { ...envelope.payload, sequence: 1, status: 'open', endReason: undefined, endedAt: undefined } });
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetryFailed, 1);
    online = true;
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 1);
    assert.equal(requests[0].key, requests[1].key, 'a retry reuses the idempotency key');
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 0, 'delivered once');
    write(3, envelope);
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 1);
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 0);
    const final = requests.at(-1).body.envelope.payload;
    assert.equal(final.status, 'completed');
    assert.deepEqual(final.timeline, envelope.payload.timeline);
    assert.deepEqual(final.bosses, envelope.payload.bosses);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

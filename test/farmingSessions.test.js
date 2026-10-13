import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeTelemetryRecord, telemetryIdempotencyKey } from '../src/telemetry.js';
import { syncOnce } from '../src/sync.js';

const envelope = JSON.parse(fs.readFileSync(new URL('../fixtures/telemetry/farming_session.v1.json', import.meta.url), 'utf8'));
function lua(value) {
  if (value == null) return 'nil';
  if (Array.isArray(value)) return `{${value.map(lua).join(',')}}`;
  if (typeof value === 'object') return `{${Object.entries(value).map(([key, entry]) => `[${JSON.stringify(key)}]=${lua(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

test('preserves farming duration, AFK uncertainty and real map edge coordinates', () => {
  const record = normalizeTelemetryRecord('farming_session:character-rook:farm-fixture', { kind: 'event', revision: 3, envelope });
  assert.deepEqual(record.envelope.payload, envelope.payload);
  const changed = normalizeTelemetryRecord(record.streamKey, { kind: 'event', revision: 4, envelope: { ...envelope, payload: { ...envelope.payload, sequence: 4 } } });
  assert.notEqual(telemetryIdempotencyKey(record), telemetryIdempotencyKey(changed));
  const unknown = structuredClone(envelope);
  unknown.payload.afkAvailable = false;
  delete unknown.payload.afkSeconds;
  unknown.payload.location.x = 0;
  unknown.payload.location.y = 1;
  const normalized = normalizeTelemetryRecord(record.streamKey, { kind: 'event', revision: 1, envelope: unknown });
  assert.equal(normalized.envelope.payload.location.x, 0);
  assert.equal(normalized.envelope.payload.location.y, 1);
  assert.equal('afkSeconds' in normalized.envelope.payload, false);
});

test('retries farming events unchanged and sends updated checkpoints once', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gw farming '));
  const savedVariablesPath = path.join(directory, 'SavedVariables', 'Guildweaver.lua');
  fs.mkdirSync(path.dirname(savedVariablesPath), { recursive: true });
  const streamKey = 'farming_session:character-rook:farm-fixture';
  function write(revision, current) {
    fs.writeFileSync(savedVariablesPath, `GuildweaverDB = ${lua({ schemaVersion: 4, sync: { outbound: { telemetry: {
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
    write(1, { ...envelope, payload: { ...envelope.payload, sequence: 1, status: 'open' } });
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetryFailed, 1);
    online = true;
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 1);
    assert.equal(requests[0].key, requests[1].key);
    write(3, envelope);
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 1);
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 0);
    assert.deepEqual(requests.at(-1).body.envelope.payload, envelope.payload);
    assert.notEqual(requests.at(-1).key, requests[0].key);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

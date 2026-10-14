import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeTelemetryRecord, telemetryTransportBody, telemetryIdempotencyKey } from '../src/telemetry.js';
import { syncOnce } from '../src/sync.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/telemetry/${name}.v1.json`, import.meta.url), 'utf8'));
const mob = load('mob_loot');
const definition = load('game_item_definition');
function lua(value) {
  if (value == null) return 'nil';
  if (Array.isArray(value)) return `{${value.map(lua).join(',')}}`;
  if (typeof value === 'object') return `{${Object.entries(value).map(([key, entry]) => `[${JSON.stringify(key)}]=${lua(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

test('preserves corpse identity, exact source allocations, dungeon and map metadata, and base definitions', () => {
  for (const [kind, envelope] of [['event', mob], ['state', definition]]) {
    const record = normalizeTelemetryRecord(envelope.eventType, { kind, revision: 1, envelope });
    assert.deepEqual(telemetryTransportBody(record).envelope.payload, envelope.payload);
    assert.equal(record.envelope.locale, 'enUS');
    const restored = normalizeTelemetryRecord(record.streamKey, { kind, revision: 1, envelope: structuredClone(envelope) });
    assert.equal(telemetryIdempotencyKey(record), telemetryIdempotencyKey(restored));
  }
  const updated = structuredClone(mob); updated.payload.outputs[0].quantity = 5;
  assert.notEqual(telemetryIdempotencyKey(normalizeTelemetryRecord('mob', { kind: 'event', revision: 1, envelope: mob })),
    telemetryIdempotencyKey(normalizeTelemetryRecord('mob', { kind: 'event', revision: 2, envelope: updated })));
});

test('SavedVariables sync retries corpse events and base definitions unchanged and sends later revisions once', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guildweaver mob loot '));
  const savedVariablesPath = path.join(directory, 'Guildweaver.lua');
  const config = { holdfastUrl: 'https://holdfast.example', telemetryEndpoint: 'https://collector.example/telemetry',
    deviceToken: 'fixture-device', savedVariablesPath, wowRoot: null, questSyncIntervalMs: Number.MAX_SAFE_INTEGER,
    statePath: path.join(directory, 'state.json') };
  let online = false;
  const requests = [];
  const fetchImpl = async (_url, options) => {
    requests.push({ body: JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
    return new Response(JSON.stringify({ status: 'accepted' }), { status: online ? 200 : 503 });
  };
  function write(revision, current) {
    fs.writeFileSync(savedVariablesPath, `GuildweaverDB = ${lua({ schemaVersion: 4, sync: { outbound: { telemetry: {
      mob: { kind: 'event', revision, envelope: current },
      definition: { kind: 'state', revision: 1, envelope: definition },
    } } } })}`);
  }
  try {
    write(1, mob);
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetryFailed, 2);
    online = true;
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 2);
    for (const stream of ['mob', 'definition']) {
      const attempts = requests.filter((entry) => entry.body.streamKey === stream);
      assert.equal(attempts[0].key, attempts[1].key);
      assert.deepEqual(attempts[0].body, attempts[1].body);
    }
    const updated = structuredClone(mob); updated.payload.outputs.push({ itemId: 2835, quantity: 1, name: 'Rough Stone' });
    write(2, updated);
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 1);
    assert.deepEqual(requests.at(-1).body.envelope.payload, updated.payload);
    assert.equal((await syncOnce(config, { fetchImpl, log: () => {} })).telemetrySent, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

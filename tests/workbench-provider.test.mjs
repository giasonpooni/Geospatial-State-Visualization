import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { WorldStore } from '../src/data/store.ts';
import { WorkbenchProvider, decodeWorkbenchView } from '../src/data/workbench/provider.ts';
import { CiwReadClient } from '../src/app/ciwClient.ts';

const fixturePath = process.env.CIW_SPATIAL_VIEW_FIXTURE ?? new URL('./fixtures/ciw-spatial-view.json', import.meta.url);
const fixture = () => JSON.parse(readFileSync(fixturePath, 'utf8'));
const sha = (raw) => 'sha256:' + createHash('sha256').update(raw).digest('hex');
const canonical = (row) => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a < b ? -1 : 1)));
function mutateSource(packet, action) {
  const source = JSON.parse(Buffer.from(packet.source.bytes_b64, 'base64'));
  action(source);
  const raw = Buffer.from(JSON.stringify(source));
  packet.source.bytes_b64 = raw.toString('base64');
  packet.source.byte_count = raw.length;
  packet.source.evidence_id = sha(raw);
  const { source_id, bytes_b64, ...descriptor } = packet.source;
  packet.source.source_id = 'source:' + sha(canonical(descriptor));
}

test('real CIW-produced packet hydrates native WorldStore without a synthetic resolver', async () => {
  const packet = fixture();
  const raw = JSON.parse(Buffer.from(packet.source.bytes_b64, 'base64'));
  const provider = new WorkbenchProvider(async () => packet), store = new WorldStore();
  const snapshot = await store.init(provider);
  assert.deepEqual(snapshot, raw.snapshot);
  assert.equal(snapshot.nodes.length, 2);
  assert.equal(provider.view.source.evidence_id, packet.source.evidence_id);
  for (const state of raw.states) for (const t of Object.values(snapshot.timeRange))
    assert.deepEqual(store.stateAt(state.entityId, t), { ...state, t });
  assert.equal(provider.view.authority.execution, 'not_performed');
  assert.equal(provider.view.authority.verification, 'not_performed');
  assert.equal(provider.view.authority.sensor_fusion, 'not_performed');
  assert.throws(() => provider.view.source.label = 'corrupt', TypeError);
  packet.source.label = 'changed after hydration';
  assert.notEqual(provider.view.source.label, packet.source.label);
});

test('outside validity or absent identity is unavailable, never zero filled', async () => {
  const provider = new WorkbenchProvider(async () => fixture());
  assert.throws(() => provider.stateAt('absent', '2026-09-22T00:00:00Z'), /unavailable/);
  const store = new WorldStore(); await store.init(provider);
  assert.throws(() => store.stateAt('absent', store.snapshot.timeRange.now), /Unknown/);
  assert.throws(() => provider.stateAt(store.snapshot.nodes[0].id, '2027-01-01T00:00:00Z'), /outside/);
});

for (const [name, mutate] of [
  ['wrong bytes', (p) => { p.source.bytes_b64 = Buffer.from('{}').toString('base64'); }],
  ['label substitution', (p) => { p.source.label += ' changed'; }],
  ['evidence alias', (p) => { p.source.evidence_id = 'sha256:' + '0'.repeat(64); }],
  ['frame axes changed in view', (p) => { p.coordinate_frame.axes.reverse(); }],
  ['false verification', (p) => { p.authority.verification = 'passed'; }],
  ['source replaced by process', (p) => { p.source.kind = 'calibrated-observable'; }],
]) test(`retained view rejects ${name}`, async () => {
  const packet = fixture(); mutate(packet);
  await assert.rejects(decodeWorkbenchView(packet));
});

for (const [name, mutate] of [
  ['missing state', (d) => { d.states.pop(); }],
  ['missing utilization', (d) => { delete d.states[0].utilization; }],
  ['unknown state identity', (d) => { d.states[0].entityId = 'absent'; }],
  ['wrong state time', (d) => { d.states[0].t = d.snapshot.timeRange.start; }],
  ['duplicate state', (d) => { d.states[1] = d.states[0]; }],
  ['state status substitution', (d) => { d.states[0].status = 'unknown'; }],
  ['invalid longitude', (d) => { d.snapshot.nodes[0].geometry.coordinates[0] = 181; }],
  ['missing frame authority', (d) => { d.snapshot.nodes[0].provenance.evidence = []; }],
  ['stale geometry', (d) => { d.snapshot.nodes[0].provenance.validTo = d.snapshot.timeRange.end; }],
  ['undeclared interpolation', (d) => { d.state_policy = 'linear'; }],
  ['fabricated event', (d) => { d.states[0].activeEventIds = ['absent']; }],
]) test(`resealed invalid declaration rejects ${name}`, async () => {
  const packet = fixture(); mutateSource(packet, mutate);
  await assert.rejects(decodeWorkbenchView(packet));
});

test('invalid replacement retains prior native snapshot', async () => {
  const store = new WorldStore();
  const first = await store.init(new WorkbenchProvider(async () => fixture()));
  const bad = fixture(); mutateSource(bad, (d) => d.states.pop());
  await assert.rejects(store.init(new WorkbenchProvider(async () => bad)));
  assert.strictEqual(store.snapshot, first);
});

test('read client refuses credentialed, executable and writable-root endpoint URLs', () => {
  for (const endpoint of ['javascript:alert(1)', 'http://localhost/spatial', 'ws://localhost/',
    'ws://user:secret@localhost/spatial', 'ws://localhost/spatial?path=arbitrary'])
    assert.throws(() => new CiwReadClient(endpoint));
});

test('provider retries a failed load without caching a fabricated or failed snapshot', async () => {
  let calls = 0;
  const provider = new WorkbenchProvider(async () => {
    if (++calls === 1) throw new Error('temporary read failure');
    return fixture();
  });
  await assert.rejects(provider.load(), /temporary/);
  assert.throws(() => provider.view, /unavailable/);
  assert.equal((await provider.load()).nodes.length, 2);
  assert.equal((await provider.load()).nodes.length, 2);
  assert.equal(calls, 2);
});

// Isolated protocol fault tests. The separate live gate uses actual CIW sockets
// and native providers; this controllable socket is not integration evidence.
async function protocolFault(response, pattern) {
  const NativeSocket = globalThis.WebSocket;
  class FaultSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(raw) {
      const request = JSON.parse(raw);
      assert.equal(request.type, 'spatial.inspect');
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(response(request)) })));
    }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  globalThis.WebSocket = FaultSocket;
  let client;
  try {
    client = new CiwReadClient('ws://127.0.0.1:8765/spatial');
    await assert.rejects(client.inspect(fixture().source.source_id), pattern);
  } finally { client?.close(); globalThis.WebSocket = NativeSocket; }
}

test('read client binds a response to the explicitly selected source, not only request id', async () => {
  await protocolFault((request) => ({ protocol_version: 1, request_id: request.request_id,
    type: 'response', payload: { source: { source_id: 'source:sha256:' + '0'.repeat(64) } } }), /substituted/);
});

test('malformed response envelope terminates the pending read immediately', async () => {
  await protocolFault(() => null, /Invalid CIW response envelope/);
});

test('server refusal is unavailable and never accepted as geographic evidence', async () => {
  await protocolFault((request) => ({ protocol_version: 1, request_id: request.request_id,
    type: 'error', payload: { message: 'source unavailable' } }), /source unavailable/);
});

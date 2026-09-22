/** Native CIW WebSocket -> GSV provider -> native WorldStore integration proof. */
import assert from 'node:assert/strict';
import { CiwReadClient } from '../src/app/ciwClient.ts';
import { WorkbenchProvider } from '../src/data/workbench/provider.ts';
import { WorldStore } from '../src/data/store.ts';

const [endpoint, sourceId] = process.argv.slice(2);
if (!endpoint || !sourceId) throw new Error('Usage: node scripts/check-ciw-workbench.mjs ws://127.0.0.1:8765/spatial source:sha256:...');
const client = new CiwReadClient(endpoint);
try {
  const provider = new WorkbenchProvider(() => client.inspect(sourceId));
  const store = new WorldStore();
  const snapshot = await store.init(provider);
  assert.equal(provider.view.source.source_id, sourceId);
  assert.ok(snapshot.nodes.length >= 1 && snapshot.nodes.length <= 128);
  for (const node of snapshot.nodes) for (const time of Object.values(snapshot.timeRange))
    assert.equal(store.stateAt(node.id, time).entityId, node.id);
  console.log(JSON.stringify({ native_provider: 'passed', source_id: sourceId,
    evidence_id: provider.view.source.evidence_id, facility_count: snapshot.nodes.length,
    coordinate_frame: provider.view.coordinate_frame, execution: 'not_performed', verification: 'not_performed' }));
} finally { client.close(); }

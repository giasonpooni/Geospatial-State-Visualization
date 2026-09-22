/** A retained CIW declaration through GSV's existing native provider boundary. */
import type { EntityState, WorldSnapshot } from '../contracts';
import type { SpatialDataProvider } from '../provider';
import { deepFreeze, identifier, instant, text, validatedSnapshot, validatedState } from '../validation.ts';

const MAX_BYTES = 262144;
const POLICY = 'declared_constant_over_inclusive_time_range';
const EMPTY = ['routes', 'flows', 'commodities', 'events', 'constraints', 'assertions', 'observations', 'cityLights'] as const;
const AUTHORITY = { read_only: true, coordinate_transform: 'not_performed', sensor_fusion: 'not_performed',
  state_admission: 'not_performed', execution: 'not_performed', verification: 'not_performed',
  physical_authenticity: 'not_established', covariance: 'not_supplied' };
type Row = Record<string, unknown>;

function keys(value: unknown, fields: string[]): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('|') !== [...fields].sort().join('|')) throw new Error('Unexpected workbench fields');
  return value as Row;
}
function same(value: unknown, expected: unknown): boolean {
  return canonical(value) === canonical(expected);
}
function canonical(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return JSON.stringify(value);
}
async function hash(bytes: Uint8Array): Promise<string> {
  return 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))]
    .map((n) => n.toString(16).padStart(2, '0')).join('');
}

export interface WorkbenchView {
  schema: 'ciw.spatial-view.v1';
  source: { schema: 'ciw.workbench-source.v1'; kind: 'geographic-context'; source_schema: 'ciw.geographic-context.v1';
    label: string; source_id: string; evidence_id: string; byte_count: number; bytes_b64: string };
  coordinate_frame: { id: 'OGC:CRS84'; axes: ['longitude', 'latitude']; unit: 'deg'; authority_ref: string };
  state_policy: typeof POLICY;
  authority: typeof AUTHORITY;
}

/** This validates bytes and native shape, not source authentication or physical truth. */
export async function decodeWorkbenchView(input: unknown): Promise<{
  view: WorkbenchView; snapshot: WorldSnapshot; states: EntityState[];
}> {
  const packet = keys(input, ['schema', 'source', 'coordinate_frame', 'state_policy', 'authority']);
  if (packet.schema !== 'ciw.spatial-view.v1' || packet.state_policy !== POLICY || !same(packet.authority, AUTHORITY))
    throw new Error('Unsupported workbench view or authority');
  const source = keys(packet.source, ['schema', 'kind', 'label', 'source_id', 'evidence_id', 'byte_count', 'bytes_b64', 'source_schema']);
  if (source.schema !== 'ciw.workbench-source.v1' || source.kind !== 'geographic-context' || source.source_schema !== 'ciw.geographic-context.v1')
    throw new Error('Expected geographic source; local coordinates cannot be mapped implicitly');
  identifier(source.source_id, 'source_id'); identifier(source.evidence_id, 'evidence_id'); text(source.label, 'source.label', 512);
  if (typeof source.bytes_b64 !== 'string' || source.bytes_b64.length > 4 * Math.ceil(MAX_BYTES / 3) ||
      !Number.isSafeInteger(source.byte_count)) throw new Error('Invalid geographic byte budget');
  const encoded = atob(source.bytes_b64);
  if (btoa(encoded) !== source.bytes_b64 || encoded.length !== source.byte_count || encoded.length > MAX_BYTES)
    throw new Error('Geographic source bytes are not canonical or bounded');
  const bytes = Uint8Array.from(encoded, (char) => char.charCodeAt(0));
  if (await hash(bytes) !== source.evidence_id) throw new Error('Geographic evidence identity mismatch');
  const { source_id, bytes_b64, ...descriptor } = source;
  if ('source:' + await hash(new TextEncoder().encode(canonical(descriptor))) !== source_id)
    throw new Error('Geographic descriptor identity mismatch');
  const declaration = keys(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    ['schema', 'coordinate_frame', 'state_policy', 'snapshot', 'states']);
  if (declaration.schema !== 'ciw.geographic-context.v1' || declaration.state_policy !== POLICY ||
      !same(declaration.coordinate_frame, packet.coordinate_frame)) throw new Error('Geographic source projection mismatch');
  const frame = keys(declaration.coordinate_frame, ['id', 'axes', 'unit', 'authority_ref']);
  if (frame.id !== 'OGC:CRS84' || frame.unit !== 'deg' || !same(frame.axes, ['longitude', 'latitude']))
    throw new Error('Expected declared CRS84 longitude/latitude degrees');
  identifier(frame.authority_ref, 'frame.authority_ref');
  const snapshot = validatedSnapshot(declaration.snapshot);
  if (snapshot.nodes.length < 1 || snapshot.nodes.length > 128 || EMPTY.some((key) => snapshot[key].length !== 0))
    throw new Error('Geographic v1 permits declared facility points without dynamic collections');
  const range = snapshot.timeRange;
  for (const node of snapshot.nodes) {
    const p = node.provenance;
    if (!p.evidence?.includes(frame.authority_ref as string) || p.validFrom === undefined || p.validTo === undefined ||
        instant(p.validFrom) > instant(range.start) || instant(p.validTo) <= instant(range.end))
      throw new Error('Facility requires explicit frame evidence and validity covering the view range');
  }
  if (!Array.isArray(declaration.states) || declaration.states.length !== snapshot.nodes.length)
    throw new Error('Every facility requires declared state; absent values are unavailable');
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const states = declaration.states.map((input) => {
    const row = keys(input, ['entityId', 't', 'utilization', 'congestion', 'status', 'activeEventIds']);
    const id = identifier(row.entityId, 'state.entityId');
    const node = nodes.get(id);
    if (!node || seen.has(id)) throw new Error('Unknown or duplicate facility state');
    seen.add(id);
    const state = validatedState(row, id, range.now, new Map());
    if (state.status !== node.status) throw new Error('Facility and declared state status disagree');
    return state;
  });
  return deepFreeze({ view: structuredClone(packet) as unknown as WorkbenchView, snapshot, states });
}

export class WorkbenchProvider implements SpatialDataProvider {
  readonly id = 'ciw:geographic-context';
  readonly label = 'CIW retained geographic context';
  private loader: () => Promise<unknown>;
  private data: Awaited<ReturnType<typeof decodeWorkbenchView>> | null = null;
  private loading: Promise<WorldSnapshot> | null = null;

  constructor(loader: () => Promise<unknown>) { this.loader = loader; }

  get view(): WorkbenchView {
    if (!this.data) throw new Error('Workbench geographic context unavailable');
    return this.data.view;
  }

  load(): Promise<WorldSnapshot> {
    if (!this.loading) this.loading = this.loader().then(decodeWorkbenchView).then((data) => {
      this.data = data; return data.snapshot;
    }).catch((error) => { this.loading = null; throw error; });
    return this.loading;
  }

  stateAt(entityId: string, t: string): EntityState {
    if (!this.data) throw new Error('Workbench geographic context unavailable');
    identifier(entityId, 'entityId');
    const range = this.data.snapshot.timeRange, time = instant(t);
    if (time < instant(range.start) || time > instant(range.end)) throw new Error('Time outside declared geographic validity');
    const state = this.data.states.find((s) => s.entityId === entityId);
    if (!state) throw new Error('Unknown geographic entity; state unavailable');
    // Re-expression at t follows the explicitly retained constant-state policy.
    // No interpolation, event model, synthetic dynamics, or zero fill occurs.
    return validatedState({ ...state, t }, entityId, t, new Map());
  }
}

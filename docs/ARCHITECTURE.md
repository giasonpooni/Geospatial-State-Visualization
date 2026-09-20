# PAYLOAD EARTH — ARCHITECTURE

This document is the engineering record for the digital-twin client. The code
is the ground truth; everything below cites the files that enforce it.

## 1. The digital-twin stance

The renderer is a **projection** of Payload state. It is never authoritative
and never mutates canonical state. Everything visual — globe, routes, particle
flows, panels — is derived from immutable snapshots handed across a typed
boundary; view-level operations (select, focus, toggle layer, scrub time) act
on the projection only.

`SyntheticProvider` supplies a `WorldSnapshot` to `WorldStore`. The `AppApi`
facade exposes read-only state and view operations to the UI; the Earth and
route layers project that state through Three.js. This build uses synthetic
records and has no live Payload Spatial API connection.

State flows down; nothing flows back up. UI components receive `AppApi` and
nothing else — they never import renderer internals and never mutate data
(`src/app/api.ts` header comment is the contract).

## 2. The seam and its mechanical enforcement

The semantic layer, `src/data/**`, is **renderer-blind by structure, not by
discipline**. `scripts/check-seam.mjs` walks every `.ts` file under
`src/data/` and fails the build on:

- any **bare-module import** (`three`, DOM libs, anything from npm — the data
  layer imports no packages at all), and
- any **relative import that escapes** `src/data/`,

with exactly two allowed pure-kernel exceptions:
`src/core/events.ts` (the typed `EventBus`) and `src/core/time.ts`
(`SimClock`). Both are dependency-free, erasable TypeScript.

The check runs as the first step of `npm run check` (which `npm run build`
runs first). If the renderer ever leaks into canonical-state land, the build
breaks instead of a reviewer having to notice. A useful side effect: because
`src/data` is pure, erasable TypeScript, Node can execute it directly via
type stripping — which is exactly what the provenance check does.

## 3. Provenance discipline

Every record that claims to describe the world carries a `Provenance` block
(`contracts.ts`): `source`, `knownAt`, optional validity window, evidence
descriptors, and confidence. This build uses `source: 'synthetic:demo'`.

`scripts/validate-provenance.mjs` does not lint types — it **executes the
real dataset** (`buildWorldSnapshot()` from `src/data/synthetic/world.ts`)
and fails the build if any node, route, flow, commodity, event, constraint,
assertion, or observation lacks `provenance.source`.

The point: **"is this real?" is a query, not a memory.** The inspector, the
disclaimer, and inspector read the same field on each record.

Related: `Route.geometryBasis` (`'routed' | 'great_circle_estimate' |
'synthetic_corridor'`) keeps *what the geometry is* queryable too — a straight
arc over a lake is not where the truck goes, and that difference must never
become cosmetic.

## 4. Promises vs evidence

`contracts.ts` splits claims into three distinct record types, never one
field overwritten by another:

- **`Assertion`** — a promise: something the system claims about an entity
  (`transit_hours`, `capacity`, `dwell_hours`), with its own provenance and
  `assertedAt`.
- **`Observation`** — evidence: a timestamped measurement, with its own
  provenance.
- **`Deviation`** — the join: `delta = observed − asserted`,
  `ratio = observed / asserted`, referencing both records.

`WorldStore.deviationsFor(entityId)` (`store.ts`) performs this join **on
demand**, matching assertions to observations by metric and computing the
mean observed value; nothing is stored back, nothing is overwritten.

`Route.estimatedDurationHours` and `Route.capacity` are convenience
projections of the current assertion of record. They must **never** be
overwritten by outcomes: the deviation history *is* the point. A twin that
replaces its estimate with the actual forgets that it was wrong; this one
keeps both records so it can show where its own estimates run optimistic —
per entity, per metric, over time.

## 5. Data contracts inventory

All shapes live in `src/data/contracts.ts` (provider-independent, WGS84
lon/lat, GeoJSON-compatible geometry subset):

| Area | Types |
|---|---|
| Identity / provenance | `EntityId`, `Timestamp`, `DataSource`, `Provenance`, `LifecycleStatus` |
| Geometry | `LonLat`, `PointGeometry`, `LineStringGeometry`, `Geometry` |
| Ontology | `TransportMode` (road/rail/maritime/air), `NodeKind` (ports … chokepoints), `EntityKind` |
| Base | `Entity` (id, kind, name, geometry, status, provenance, `importance` 0..1 for LOD, country, tags) |
| Facilities | `Facility` + `Port`, `Airport`, `RailTerminal`, `Warehouse`; `QuantityRating` |
| Routes | `Route` (first-class semantic object: origin/destination, distance, promised duration, capacity, utilization, `constraints`, `historicalState` samples, `geometryBasis`), `RouteConstraint`, `RouteStateSample`, `TransportSegment` |
| Commodities / flows | `Commodity`, `Flow` (chain of `TransportSegment`s; `intensity` drives particle density) |
| Promises vs evidence | `Assertion`, `Observation`, `Deviation` |
| Constraints / events | `Constraint`, `WorldEvent` |
| Temporal | `TemporalRegime`, `TemporalState`, `EntityState` |
| Snapshot | `WorldSnapshot` — nodes, routes, flows, commodities, events, constraints, assertions, observations, cityLights, timeRange, meta (label + **disclaimer**) |

### The provider interface

`src/data/provider.ts` defines `SpatialDataProvider` — the only thing the
twin client ever talks to for data:

```ts
interface SpatialDataProvider {
  readonly id: string;
  readonly label: string;
  load(): Promise<WorldSnapshot>;                       // initial hydration
  stateAt(entityId: EntityId, t: Timestamp): EntityState; // deterministic
  query?(viewport: ViewportQuery): Promise<Partial<WorldSnapshot>>; // optional
  subscribe?(onDelta: (delta: Partial<WorldSnapshot>) => void): () => void; // optional
}
```

`SyntheticProvider` (`src/data/synthetic/provider.ts`) implements it today:
all dynamic state is a pure function of `(entityId, t)` — hash-seeded
sinusoids plus smooth event ramps, no randomness, no wall clock. The interface
requires `load()` and `stateAt()`; `query()` and `subscribe()` are optional.
No live provider is implemented in this build.

`WorldStore` (`src/data/store.ts`) sits on top of whichever provider is
plugged in: it indexes the snapshot (nodes, routes-by-node, flows-by-route,
assertions/observations-by-entity), resolves temporal state through the
provider (`stateAt`), computes deviations, filters active events, and serves
scored fuzzy search. It is read-only by design and renderer-blind by the
seam check.

## 6. Rendering architecture

Three.js scene composed from independent modules:

- **Earth** (`src/earth/*`, `src/geo/texture.ts`): procedural equirectangular
  day/night/mask textures generated at boot from Natural Earth 50m land
  topology (world-atlas TopoJSON in `public/data/`) plus corpus city lights.
  No external imagery — the planet is drawn, not photographed; seeded
  generation makes every boot identical. Atmosphere, graticule, and starfield
  are separate scene modules.
- **Countries** (`src/geo/countries.ts`): Natural Earth 110m borders as line
  geometry, point-in-polygon picking on lon/lat, selection outlines.
- **Routes** (`src/layers/routesLayer.ts`): per-mode route rendering — each
  `TransportMode` gets its palette color (`src/app/palette.ts`) and its
  routes are drawn as polylines on the sphere, driven by the semantic
  `Route` records, never decorative.
- **Flow particles** (`src/layers/flowsLayer.ts`): route polylines are baked
  into a float `DataTexture` (one row per route, 128 arc-length samples);
  each particle is `(row, phase, speed)` and the **vertex shader** advances
  phase with time and reads position from the texture — thousands of moving
  loads in one draw call with zero per-frame CPU geometry work. Particle
  density is proportional to `Flow.intensity`; particles are
  representational, not real shipments.
- **LOD / progressive disclosure**: camera altitude (`CameraFacade.
  altitudeRadii()`) and `Entity.importance` gate what is drawn and labeled —
  high orbit shows the skeleton, descending reveals detail (nodes layer,
  labels layer).
- **Layer compositing** (`src/layers/layerManager.ts`): the `LayerId` set
  from `api.ts` maps onto scene-object visibility; presets are curated layer
  combinations; `layersChange` events keep UI panels in sync.
- **Camera** (`src/core/cameraController.ts` behind `CameraFacade`): fly-to,
  route framing, and the cinematic follow-path dolly used by Follow the Load.

## 7. Command and tool interfaces

The command bar grammar lives in `src/app/commands.ts`: pure functions
(`executeCommand`, `suggestCommands`) over the `AppApi` facade — no module
state, no DOM. The facade exposes: layer toggles, presets, search/focus, flow filtering, clock
control, route comparison, the demo scenario.

`src/app/toolSurface.ts` implements the GeoAgent pattern: **one structured
registry of operations over `AppApi`** — each entry a name, a typed
parameter list, a description, an executor, and safety flags
(`destructive` / `longRunning` / `requiresConfirmation`, all false today
because every operation is a view operation on a mirror). The text grammar
in `commands.ts` is one front end to the same facade; an agent binding
(Payload agents, MCP, tool-use) consumes the registry directly — it is
exposed at runtime as `window.payloadEarth.tools` with
`window.payloadEarth.invokeTool(name, args)`. Capabilities stay defined
once. The registry currently exposes view operations only.

## 8. Temporal model

`SimClock` (`src/core/time.ts`) is the global temporal control: sim time is
scrubbed and played independently of the wall clock, configured against the
snapshot's `timeRange { start, end, now }`.

- **Regime**: `TemporalRegime` is derived from sim time vs the dataset's
  `now` — within ±30 minutes is `'current'`, before is `'historical'`, after
  is `'forecast'` (`'scenario'` is reserved for future scenario branches).
- **Playback**: `tick(dtSeconds)` advances sim time at `speed` sim-seconds
  per wall-second (default 3600 = 1h/s; the `speed 6h` command sets 21600),
  clamping and pausing at the range end. `setFraction` scrubs; `jumpToNow`
  returns to the regime boundary.
- **Determinism**: every dynamic layer resolves entity state as
  `store.stateAt(entityId, clock.simTime)`, which delegates to the provider.
  The provider contract requires `stateAt` to be deterministic for a given
  `(entityId, t)` — the synthetic implementation is a pure hash-seeded
  function — so scrubbing is stable: the same instant always renders the
  same world. `world.ts` precomputes `Route.historicalState` with the same
  resolver, so the sparse temporal spine and live `stateAt()` agree by
  construction.

Clock changes fan out through the typed `EventBus` (`src/core/events.ts`) as
`TemporalState` events; the timeline UI, layers, and status bar all subscribe
to the same stream.

## 9. Scope

This renderer presents synthetic network data at a planetary scale. It does not
simulate physical facilities, vehicles, or ocean dynamics, and its forecasts
are synthetic demo values rather than measured outcomes.

## 10. Display semantics

These are product requirements of the whole platform, present in this
renderer from the first record:

- **Provenance is a property of the record, not a label on the UI.**
  Every synthetic record carries `provenance.source: 'synthetic:demo'` in
  the same field a real record will carry `'external:ais'` — "is this
  real?" is a query. The status bar's persistent SYNTHETIC / DEMO DATA
  chip and every inspector's EVIDENCE section *read* that field; they do
  not replace it.
- **A number carries its warrant.** The route inspector shows PROMISED
  transit (an `Assertion`) against OBSERVED transits (`Observation`s) and
  the resulting deviation with `n=` — never a bare number that forgets
  where it came from.
- **Which kind of nothing.** `LifecycleStatus` includes `'unknown'` and the
  palette reserves an unobserved tone (`UNKNOWN`, mirroring the
  Terminal's `--unk`): the render channel for "we do not currently know"
  exists before real telemetry does, so an 11-hour-old position is never
  drawn as a confident dot.
- **Geometry states its basis.** `Route.geometryBasis`
  (`'routed' | 'great_circle_estimate' | 'synthetic_corridor'`) keeps the
  difference between a routed path and an estimate queryable. All
  distances derived in this client are great-circle estimates and are
  presented as such, never as road distance.

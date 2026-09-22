# CIW geographic view contract

The existing `SpatialDataProvider` and `WorldStore` receive a selected retained
`ciw.geographic-context.v1` source through `ciw.spatial-view.v1`. No renderer,
estimator or frame-transform implementation is duplicated in CIW.

| Boundary | Retained meaning |
| --- | --- |
| `source.source_id` | CIW descriptor identity, including label and exact evidence digest |
| `source.evidence_id` | SHA-256 of the original UTF-8 declaration bytes |
| `source.bytes_b64` | Original bytes, including formatting and number spelling |
| `coordinate_frame` | `OGC:CRS84`, ordered longitude/latitude axes, degrees, declared authority reference |
| `snapshot` | Native GSV facility-point records and original provenance |
| `states` | One complete native `EntityState` per facility, anchored at `timeRange.now` |
| `state_policy` | Explicit constant state over the inclusive native time range |
| `authority` | Read-only projection; no fusion, execution, verification, admission or authenticity claim |

The first bounded source has 1–128 facility points. Routes, flows, commodities,
events, constraints, assertions, observations and city lights are empty. Each
facility retains the frame authority reference in its evidence list and a
half-open validity interval covering every selectable instant, including the
native viewer's inclusive final instant. Known time is preserved independently.
States require utilization, congestion, lifecycle status and an empty active-event
list. Status must match the facility record. A missing value is unavailable.

The provider hashes bytes and descriptor independently, checks the packet's
mapping back to its retained declaration, invokes native `validatedSnapshot`
and `validatedState`, then hydrates the original `WorldStore`. It retains an
immutable detached snapshot. A failed replacement cannot alter the active view.
Re-expressing a declared constant state at another valid instant follows the
explicit policy; no synthetic resolver or interpolation is called.

`CiwReadClient` sends only `spatial.inspect`. The CIW server enforces the read-only
boundary separately: explicitly configured browser origins may connect only
to `/spatial`, which accepts `spatial.list` and `spatial.inspect`, even for clients
without an Origin header. An existing native desktop connection is separate.
There is no inferred credential, executable path or script URL in a source.

Use Node 24 and run `npm run build`. Native tests consume the checked-in packet
exported by the real CIW helper. To consume a newly exported packet:

```sh
CIW_SPATIAL_VIEW_FIXTURE=/path/to/spatial-view.json node --test tests/workbench-provider.test.mjs
```

To exercise the actual CIW WebSocket, the provider and native WorldStore together:

```sh
node scripts/check-ciw-workbench.mjs ws://127.0.0.1:8765/spatial source:sha256:YOUR_RETAINED_SOURCE_DIGEST
```

The supplied demonstration has two synthetic manufacturing facilities. It is
integration evidence, not a claim about a real factory or an independent
scientific verification. The packet carries no numerical operation or replay
identity; repeating a view must preserve the evidence identity.

# Traffic Validation Pipeline

## Goal
Use Google Maps Platform, HERE, or TomTom as a private confirmation layer for model validation, not as a public traffic data source.

## Scope
- Ingest traffic API responses into a local snapshot store.
- Normalize provider-specific payloads into a shared schema.
- Compare snapshots against simulation output or your own private data.
- Persist only derived validation outputs when possible.
- Keep raw provider data private and license-compliant.

## Provider Policy
- `Google Maps Platform`: use only if the license and product terms explicitly allow the exact caching and validation workflow you need.
- `HERE`: use as an API-backed traffic source for internal validation, subject to plan limits and caching rules.
- `TomTom`: use as an API-backed traffic source for internal validation, subject to plan limits and caching rules.

## Local Data Layout
- `data/traffic-validation/providers/`: provider configs, credentials references, and request templates.
- `data/traffic-validation/raw/`: short-lived raw API responses if caching is permitted.
- `data/traffic-validation/snapshots/`: normalized provider snapshots.
- `data/traffic-validation/derived/`: segment speeds, congestion bands, incident counts, and validation summaries.
- `data/traffic-validation/runs/`: per-run metadata linking snapshots to model runs and scenarios.

## Minimal Snapshot Schema
Each snapshot should store:
- provider name
- request timestamp
- observation window start and end
- bounding box or route corridor
- requested transport mode or traffic product
- source request id or trace id
- normalized segment list
- incident list, if present
- confidence or freshness metadata, if the provider exposes it

## Normalized Segment Shape
Recommended normalized fields:
- `segmentId`
- `roadName`
- `geometry`
- `speedKph`
- `travelTimeSeconds`
- `delaySeconds`
- `congestionLevel`
- `confidence`

## Validation Flow
1. Select a scenario, corridor, or bounding box.
2. Request provider traffic for the same area and time window.
3. Store the raw response only if the license allows temporary caching.
4. Normalize the response into the shared snapshot format.
5. Run a model comparison against the same geometry and time window.
6. Emit a `ValidationResult` with deltas and pass/fail thresholds.
7. Keep the result local for regression testing and benchmark review.

## Acceptance Criteria
- Snapshots can be replayed deterministically.
- Validation jobs are reproducible from stored metadata.
- Public UI shows only derived metrics, not provider payloads.
- The pipeline can be disabled or swapped per provider without changing the rest of the app.

## Implementation Order
1. Add the local `traffic-validation` folder contract.
2. Define the shared snapshot and validation result schemas.
3. Add provider adapters for HERE and TomTom.
4. Add an optional Google adapter behind a strict license gate.
5. Wire snapshots into the scoring and comparison pipeline.
6. Expose only derived validation summaries in the app.

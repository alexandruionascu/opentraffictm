# Traffic Simulator

## Goal
Support live browser simulation and model comparison for cars, buses, pedestrians, crossings, queues, and traffic-light intervals.

## Model Backends
- `browser-native`: deterministic TypeScript model, default for demos.
- `sumo-import`: imported SUMO network/routes/traces/signals.
- `sota-adapter`: future external models using the same scenario and trace contracts.

## Browser-Native V1
- Deterministic simulation clock with pause/play/speed controls.
- Actors follow route geometry with type-specific speeds and rendered lane offsets.
- Vehicles stop at red/yellow signal stop lines.
- Same-lane vehicles respect leaders and form deterministic queues behind stopped traffic.
- Pedestrians cross on pedestrian-safe timing.
- Metrics include active actors, waiting actors, throughput, and progress.

## Next Work
- Replace the browser-native queue clamp with a calibrated IDM or equivalent baseline.
- Add explicit lane graph, turning movements, queue spillback across upstream intersections, stop lines, and crossing phase groups.
- Add live transport feedback loops so bus/probe updates can influence corridor delay and queue estimates.
- Add trace export/import so model runs can be replayed exactly.

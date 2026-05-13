# Data Architecture

## Folder Contract
- `data/osm/`: OSM extracts, Overpass responses, road graph, lanes, crossings, intersections.
- `data/satellite/`: satellite provider metadata only; do not store Google tiles unless license allows it.
- `data/scenarios/`: scenario definitions.
- `data/simulation/`: browser-native configs and generated traces.
- `data/sumo/`: SUMO network files, routes, detector outputs, and FCD traces.
- `data/traffic-lights/`: real signal intervals and phase programs.
- `data/traffic-validation/`: licensed traffic snapshots, derived metrics, and evaluation outputs from private API sources.
- `data/vehicles/`: vehicle, bus, and pedestrian profiles.
- `data/leaderboards/`: submissions, scores, and run metadata.
- `data/papers/`: paper metadata, citations, methodology notes, and downloaded PDFs.
- `data/sources/`: raw source manifests and extraction logs.

## Core Schemas
- `Scenario`: bounds, actors, routes, signals, duration, model config.
- `Actor`: type, route, speed profile, behavior profile.
- `SignalProgram`: intersection, phases, cycle time, offsets.
- `SimulationTrace`: timestamped positions, waits, speeds, and metrics.
- `ModelRun`: model id, scenario id, input version, output trace, score metadata.
- `LeaderboardEntry`: team/model, track, coverage, score, errors, summary.
- `TrafficSnapshot`: provider, timestamp window, bounding box, requested geometry, and normalized segment/incidents payload.
- `ValidationResult`: provider snapshot id, model run id, metric deltas, acceptance flags, and notes.

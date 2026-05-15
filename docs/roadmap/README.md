# OpenTrafficTM Roadmap

## Priority
The first priority is a full-screen, gorgeous, live traffic environment for Timișoara. It must render OSM-based city context, vehicles, buses, pedestrians, traffic lights, model controls, and scenario playback.

## Direction
- Build the app as React + Vite + TypeScript.
- Use MapLibre with OSM tiles/vector data as the default map path.
- Add a free, licensed satellite provider adapter for the aerial mode; keep Google as an optional future adapter only if licensing and billing are handled.
- Support both a browser-native deterministic traffic model and SUMO-backed imports.
- Keep data extractable in clear subfolders under `data/`.

## Execution Order
1. Finish `/map` as the main product surface.
2. Add a Timisoara-first paper corpus and download pipeline for reusable traffic-model references.
3. Extract real OSM road graph, lane topology, stop lines, and intersection data for Timișoara.
4. Expand the browser-native simulator with live transport feedback and stronger queue behavior.
5. Add SUMO import/export adapters.
6. Add technical papers, data viewers, and leaderboards as secondary pages.
7. ~~Import real traffic-light intervals and compare model timing against real timing.~~ ✓ Done — see docs/roadmap/07-live-traffic-lights.md
8. **Adaptive traffic light control** — parameterize TACTICS fuzzy reactive control from STPT probe data; validate against ground truth benchmarks. ✓ Done — see docs/roadmap/07-live-traffic-lights.md
9. **Historical time-series analysis** — build arrival distributions across `data/traffic-flow/archive/` snapshots for day-to-day variation detection.
10. **SUMO co-simulation** — compare TACTICS decisions against SUMO-microsimulated ground truth for central Timișoara network.
11. **Real-time control loop** — integrate STPT live vehicle positions → queue estimator → TACTICS → adapted signal programs.
12. **RL policy training** — use arrival distribution outputs as state features for reinforcement learning of optimal green time policies.

## Done

| Item | Status | Output |
|------|--------|--------|
| Traffic analysis pipeline (5 phases) | ✅ | `data/derived/*.json`, `data/derived/*.csv` |
| Arrival distribution model | ✅ | `data/derived/arrival-model.json` (7,639 approaches) |
| TACTICS fuzzy reactive control | ✅ | `data/derived/tactics-results.json` (1,131 × 6h) |
| Greedy offset optimizer | ✅ | `data/derived/greedy-optimization.json` |
| Benchmark (TACTICS vs greedy vs baseline) | ✅ | `data/derived/benchmark-results.json` (TACTICS wins all 4) |

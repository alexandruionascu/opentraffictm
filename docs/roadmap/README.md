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
7. Import real traffic-light intervals and compare model timing against real timing.

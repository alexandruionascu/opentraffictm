# Full-Screen Map Viewer

## Goal
Create a full-screen Timișoara traffic viewer that looks premium enough for a hackathon demo and is technically ready for real simulation overlays.

## Implementation
- Use `/map` as the primary route.
- Load MapLibre dynamically and center the map on Timișoara.
- Default to OSM-compatible tiles.
- Keep a cinematic fallback map for offline or blocked CDN/tile access.
- Render overlays for cars, buses, pedestrians, traffic lights, and model status.

## Next Work
- Replace raster OSM tiles with a vector style when a stable tile source is selected.
- Add road graph overlays from `data/osm/`.
- Add toggle controls for roads, signals, buses, pedestrians, congestion, queues, and satellite.
- Add a licensed provider adapter for optional alternative satellite imagery if needed later.

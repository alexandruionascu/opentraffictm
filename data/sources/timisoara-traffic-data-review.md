# Timișoara Traffic Data Review

Generated: 2026-05-12

## What We Have

### Official Timișoara Open Data

Fetched into `data/sources/timisoara-open-data/` with `scripts/fetch-timisoara-open-data.mjs`.

- `transportul-public-normat.csv`: annual public transport indicators, including fleet/passenger/route-length style metrics.
- `infrastructura-rutiera-normat.csv`: annual road infrastructure indicators, such as urban street length and modernized street length.
- `sistemul-de-biciclete-trotinete-normat.csv`: annual bicycle system indicators.
- `sistem-feroviar-transport-feroviar-normat.csv`: annual rail infrastructure/use indicators.
- `ckan-mobilitate-package-search.json`: source catalog metadata and license metadata.

These files are useful for city-scale assumptions, long-term scenario framing, and model documentation. They are not enough to validate live congestion, intersection queues, signal phases, or car speeds.

### OpenStreetMap

Already fetched into `data/osm/`.

- Road geometry.
- Road classes, lanes where mapped, one-way tags, crossings, and traffic-signal nodes.

OSM is good for network geometry and approximate rules. It is not a measured traffic source.

## What Is Publicly Referenced But Not Directly Fetched

### STPT / Tranzy Public Transport Open Data

STPT states that Timișoara public transport data is available through Tranzy open data, including vehicles, routes, stations, and real-time data updated roughly every 20 seconds. This is the strongest legally usable real-time mobility source found so far.

Implemented:

- `scripts/fetch-stpt-live.mjs` discovers STPT lines from `https://live.stpt.ro/stations-index.php`.
- It fetches route-level live vehicles from `https://live.stpt.ro/gtfs-vehicles.php?route={route}`.
- It writes `data/sources/stpt-live/latest-vehicles.json`.
- It writes `data/sources/stpt-live/latest-vehicles.geojson`.
- It archives each snapshot in `data/sources/stpt-live/archive/`.
- The map page reads `latest-vehicles.geojson` and renders a real STPT vehicle overlay.

Action still needed:

- Get/confirm Tranzy open-data API access instructions and credentials if required.
- Confirm whether `live.stpt.ro` proxy endpoints are intended for reuse or whether Tranzy wants consumers to use a separate authenticated open-data endpoint.
- Add a scheduler for periodic archival outside local manual runs.
- Use bus/tram/trolley positions as probe vehicles for corridor speed and delay estimation.

### Traffic Monitoring / Signal Data

The municipality publicly describes a traffic-monitoring department that can access real-time/offline traffic diagnostics, traffic-management systems, video monitoring, and signal timing checks. I did not find an open API for these data.

Action needed:

- Treat signal phases and car counts as unavailable unless the city provides a feed or export.
- Submit a formal data request for anonymized detector counts, signal plans, phase timings, and intersection queue/delay aggregates.

## What We Should Not Scrape

Google Maps traffic is not a freely reusable traffic dataset. We should not scrape tiles, congestion overlays, directions durations at scale, or live traffic layers for model training/calibration unless we have a licensed Google Maps Platform agreement that explicitly permits that use.

## Recommended Data Plan

1. Use OSM for topology and road rules.
2. Use official CKAN annual indicators for background demand and documentation only.
3. Integrate STPT/Tranzy realtime transit positions as the first real live mobility feed.
4. Add an archival job that stores periodic transit vehicle snapshots.
5. Build a Timisoara-first paper corpus focused on calibration, congestion prediction, signal control, and local road-infrastructure studies.
6. Request city traffic-management exports for actual car counts, detector speeds, queues, lane counts, and traffic-light programs.
7. Only after that, calibrate the browser simulation against real observed movement.

## Public-Facing Models
- Corridor congestion viewer built from live STPT probes and open traffic traces.
- Signal-control comparison demo for fixed-time versus adaptive timing.
- Lane-aware topology and queue spillback layer for the busiest corridors.
- Open benchmark page that surfaces paper-backed datasets, model cards, and citations.
- Public impact layer that connects traffic intensity to emissions and neighborhood-level pressure.

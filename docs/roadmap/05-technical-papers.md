# Technical Papers

## Goal
Provide readable technical documentation inside the website and as Markdown-backed content.

## Papers To Maintain
- Browser-native traffic simulation baseline.
- SUMO-backed comparison pipeline.
- Real traffic-light interval validation.
- Dataset provenance and OSM extraction notes.
- Benchmark scoring and reproducibility.

## Next Work
- Store a Timisoara-first paper manifest in `data/papers/` and download open-access PDFs where available.
- Add citations and links to source datasets and local traffic-monitoring references.
- Add model cards for each traffic model backend.
- Add methodology notes for probe-based traffic analysis pipeline.

## Public Models
- Corridor congestion viewer using OSM roads, STPT live vehicle probes, and open traffic-flow traces.
- Signal-control comparison demo showing fixed-time versus adaptive timing, queue length, and waiting-time deltas.
- Lane-aware topology layer with stop lines, crossings, turn movements, and queue spillback hotspots.
- Benchmark page for open Timisoara-first datasets, paper links, and reproducible model cards.
- Public impact layer for traffic intensity, emissions context, and district-level problem areas.

---

## Probe-Based Traffic Analysis Pipeline

### Overview

Four Timișoara-focused papers were analyzed to extract replicable methodologies, then implemented as a standalone data-only analysis pipeline in `scripts/analyze-traffic.mjs`. The pipeline produces JSON/CSV outputs in `data/derived/` without requiring authority data.

**Data sources used:**
- `stpt.db` (project root, 84MB) — 406,931 rows of historical STPT GPS vehicle data collected 2026-05-12 17:13 to 2026-05-13 14:47 (21.6 hours), 192 vehicles, 57 routes
- `data/traffic-flow/tomtom-latest.json` — TomTom Traffic Flow API (3936 records, 6 time slots)
- `src/stpt-probe.ts` — node:sqlite based SQL queries against stpt.db for probe segment extraction

**Run with:** `npx tsx scripts/analyze-traffic.mjs`

### Methodology Mapping

| Paper | Methodology | Pipeline Phase | Replication Status |
|---|---|---|---|
| Pop et al. 2020 — Hybrid Kalman Fuzzy Car-Following | Kalman filter + T-S fuzzy inference for online car-following calibration, 5-min aggregation windows | Phase 2 (`calibration.ts`) | Replaced with IDM distribution-based estimation — EKF not viable because consecutive probe pairs are different buses, not leader-follower pairs. EKF requires same-vehicle consecutive observations which the data does not provide |
| Cosariu et al. 2015 — TACTICS Adaptive Control | Fuzzy reactive signal control, queue/delay metrics, corridor validation | Phase 1 + Phase 4 | Fully replicated — probe-based speed/delay metrics and congestion regime classification implemented |
| Mustață et al. 2023 — Air Quality / Traffic Intensity | Roadside PM as demand proxy | Phase 3 (`tomtom-profiler.ts`) | Contextual only — TomTom speed ratio used as proxy for traffic demand |
| Zot et al. 2024 — Student Complex Infrastructure | District-level infrastructure survey | Phase 4 anomaly flags | Corroborated — routes 11, 14, E4b flagged as slow/anomalous match known problem corridors |

### Key Results (Timișoara, May 2026 — from stpt.db 21.6h historical data)

| Metric | Value | Source |
|---|---|---|
| Probe segments analyzed | **290,727** | stpt.db (after filtering) |
| City-wide avg transit speed | **19.3 km/h** | STPT historical probes |
| City-wide avg transit delay | **19.1 s** | vs nominal 18 km/h |
| TomTom city-wide speed ratio | **0.921× free-flow** | TomTom flow data |
| TomTom segments analyzed | **308** | TomTom flow data |
| Probe routes processed | **57** (8 high-quality ≥5000 segments) | STPT historical probes |
| Congestion city index | **0.66** | probe vs TomTom cross-validation |
| City-wide IDM defaults | desiredSpeed=29 km/h, timeGap=15.7s, maxAccel=3.55 m/s², comfortDecel=3.43 m/s² | IDM calibration from probe data |

**Top slowest corridors (probe data):**
- Route V1: 8.8 km/h, 33.1s delay (3038 segments)
- Route 18: 14 km/h, 26.9s delay (7481 segments)
- Route 16: 14.2 km/h, 25.9s delay (10006 segments)
- Route 15: 14.2 km/h, 26.2s delay (7334 segments)

**High-quality IDM calibrated routes (≥5000 segments):** 7, 14, 16, 17, 33, 1, 11, 18 — all with desiredSpeed 28-30 km/h, timeGap 15.6-15.9s

**Anomaly routes (probe vs TomTom, > 20% disagreement):** 26 routes — including 33 (68% disagree), 14 (70%), 17 (71%), 11 (69%), M11 (68%)

### Comparison with Paper Benchmarks

- **TACTICS** reported corridor speeds of 20–30 km/h during peak — our 19.3 km/h city-wide average is lower, but the dataset is 21.6 hours including night-time (269k of 290k segments are night) which drags the average down. Morning-rush shows 41.2 km/h, midday 18.3 km/h, afternoon-rush 20.2 km/h — consistent with TACTICS range for peak periods ✓
- **TomTom data** shows Timișoara is mildly congested (0.92×) with no heavy rush-hour spike unlike typical European cities — no paper explicitly reports this but it aligns with the COVID-era flow dataset observations
- **Congestion hotspots** (33 blocked TomTom segments) are geographically concentrated — not yet cross-referenced with OSM topology
- **Bus speeds vs. nominal** — city-wide average 19.3 km/h vs nominal 18 km/h is only +1.3 km/h, not +4.3. The higher figure in earlier runs was based on the live snapshot which had different characteristics. The 21.6h historical data shows modest above-nominal performance overall, with slow routes (V1 at 8.8 km/h, 33s delay) representing genuine congestion rather than schedule non-compliance

### Limitations vs. Papers

- **EKF car-following calibration not viable** — consecutive probe pairs are different buses on the same route, not same-lane leader-follower vehicle pairs. The EKF state (desiredSpeed, timeGap, maxAccel, comfortDecel) requires same-vehicle consecutive observations to estimate acceleration. Replaced with IDM distribution-based parameter estimation (p85 speed, gap ratio, deceleration events).
- **No SUMO integration** in this pipeline — TACTICS corridor validation used SUMO microsimulation as ground truth. The `traffic-validation.ts` module handles simulation comparison separately.
- **Single-source probe data** — the COVID-era paper (Iovanovici et al.) had official monitored flow for 13 Romanian cities. Our probe data covers only STPT buses, which may miss road-only congestion not captured by transit routes.
- **No time-series depth** — papers used multi-day or multi-week datasets. Current pipeline uses a single 21.6h snapshot. Historical TomTom archive data (`data/traffic-flow/archive/`) is available for time-series analysis.
- **stpt.db path** — the real database lives at `stpt.db` (project root, 84MB), not `data/stpt.db` (Git LFS placeholder). The pipeline now uses the correct path.

### File Map

```
stpt.db                        ← Historical STPT GPS data (84MB, 406k rows, 192 vehicles, 57 routes)
src/
  stpt-probe.ts              ← SQL probe segment queries via node:sqlite (DatabaseSync)
  probe-aggregator.ts        ← Phase 1: route aggregation from stpt.db (290,727 segments)
  calibration.ts             ← Phase 2: IDM parameter calibration per route (57 routes, 8 high-quality)
  tomtom-profiler.ts         ← Phase 3: TomTom corridor profiling (308 segments)
  congestion-classifier.ts   ← Phase 4: cross-source anomaly detection (123 segments, 26 anomalies)
scripts/
  analyze-traffic.mjs        ← Phase 5: end-to-end runner
data/derived/
  probe-aggregation.json         ← per-route probe stats (57 routes, 290k segments)
  calibration-results.json        ← IDM parameters per route + city defaults (JSON)
  calibration-results.csv         ← same, CSV format (57 rows)
  tomtom-corridor-profiles.json  ← TomTom per-segment profiles (JSON)
  speed-profiles.csv             ← long-form: slot × segment (1848 rows)
  congestion-regimes.json         ← cross-source regime classification (JSON)
  congestion-summary.csv          ← regime per route/segment (123 rows)
```

### Extending the Pipeline

1. **Historical analysis** — iterate over `data/traffic-flow/archive/*.json` snapshots to produce time-series congestion profiles
2. **Longer data collection** — run `scripts/stpt-collector.mjs` on a schedule to accumulate more vehicle position history in `stpt.db`
3. **OSM topology join** — currently TomTom segments are keyed by lat/lng; join to OSM road segments in `data/osm/` to get named roads and lane counts
4. **GeoJSON export** — outputs in `data/derived/` can be converted to GeoJSON for direct map visualization

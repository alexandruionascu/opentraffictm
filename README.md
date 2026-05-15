# OpenTrafficTM

**Traffic Analysis & Simulation Platform for Timișoara, Romania**

[![React](https://img.shields.io/badge/React-19.0.0-61dafb?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.0-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-7.0.0-646cff?style=flat-square&logo=vite)](https://vitejs.dev)
[![MapLibre](https://img.shields.io/badge/MapLibre-5.24.0-5ac4dd?style=flat-square&logo=openstreetmap)](https://maplibre.org)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003b57?style=flat-square&logo=sqlite)](https://github.com/WiseLibs/better-sqlite3)
[![Node](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=nodedotjs)](https://nodejs.org)

**OpenTrafficTM** is an open-source traffic research platform combining real-world probe data, browser-native simulation, and academic methodology validation—all focused on Timișoara, Romania.

The platform integrates live vehicle GPS streams from STPT, TomTom Traffic Flow API, HERE, and Google Maps into a unified analysis pipeline. It delivers a live map viewer, deterministic traffic simulation, probe-based congestion analysis, and a model benchmark system.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Live Traffic Map** | Full-screen MapLibre GL map with real-time STPT vehicle positions, TomTom congestion overlays, traffic signals, and road closures |
| **Browser Simulation** | Deterministic queue-model traffic simulation with play/pause/speed controls for cars, buses, and pedestrians |
| **Probe Analysis Pipeline** | 5-phase pipeline extracting speed profiles, calibrating IDM car-following models, and classifying congestion regimes |
| **Multi-Source Validation** | Provider adapters for Google, HERE, TomTom, STPT, and municipal closure data |
| **Traffic Light Inference** | 24-hour phase estimation, stop detection, pass extraction, and map matching |
| **Benchmark System** | 5-track leaderboard (Human, Agent, Browser Native, SUMO, SOTA) with scenario-based scoring |

---

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19.0.0, TypeScript 5.9.0 |
| Build | Vite 7.0.0 |
| Maps | MapLibre GL 5.24.0, Leaflet 1.9.4 |
| Database | better-sqlite3 9.4.3 (SQLite) |
| Processing | Node.js scripts (.mjs) |
| Parsing | cheerio 1.0.0 |

### Data Flow

```
DATA SOURCES
  ├── STPT Live → stpt.db → Probe Aggregation
  ├── TomTom API → traffic-flow/ → Corridor Profiling
  ├── HERE API → traffic-validation/
  └── OSM Overpass → osm/

ANALYSIS PIPELINE
  Phase 1: Probe Aggregation (290,727 segments)
  Phase 2: IDM Calibration (57 routes → 8 high-quality)
  Phase 3: TomTom Profiling (308 corridor segments)
  Phase 4: Congestion Classification + Anomaly Detection
  Phase 5: Export to CSV/JSON
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Fetch live data
npm run fetch:stpt-live
npm run fetch:traffic:flow
npm run fetch:traffic:here
npm run fetch:traffic:tomtom

# Fetch municipal data
npm run fetch:timisoara-open-data
npm run fetch:timisoara-road-closures
```

---

## Traffic Analysis Results

From **21.6 hours** of STPT probe data (2026-05-12 17:13 → 2026-05-13 14:47):

| Metric | Value |
|--------|-------|
| City-wide avg transit speed | **19.3 km/h** |
| City-wide avg delay | **19.1 s** |
| TomTom speed ratio | **0.921x** free-flow |
| Congestion city index | **0.66** |
| Probe segments analyzed | **290,727** |
| Routes calibrated | **57** (8 high-quality) |
| Anomaly routes detected | **26** |

### IDM Calibration Defaults

| Parameter | Value |
|-----------|-------|
| desiredSpeed | 29 km/h |
| timeGap | 15.7 s |
| maxAccel | 3.55 m/s² |
| comfortDecel | 3.43 m/s² |

### Slowest Corridors

| Route | Avg Speed |
|-------|-----------|
| V1 | 8.8 km/h |
| 18 | 14 km/h |

---

## Adaptive Traffic Light Control Research

A data-driven research line was added to investigate whether arrival distributions can be inferred from existing probe data, and how they map to adaptive signal control strategies — specifically the TACTICS fuzzy reactive control framework from Cosariu et al. 2015.

### Arrival Distribution Model

STPT probe segments (290,727) were mapped to 1,123 signal approaches across 7 time slots. Speed distributions were fitted per approach × slot using gamma and lognormal distributions with Kolmogorov-Smirnov goodness-of-fit testing.

| Metric | Value |
|--------|-------|
| Signals with probe data | **1,123 of 1,131** |
| Approaches fitted | **7,639** |
| City-wide speed ratio (morning-rush) | **0.528x** free-flow |
| City-wide speed ratio (afternoon-rush) | **0.523x** free-flow |
| Heavy/blocked approaches | **6,346 (83%)** |
| Best fit: gamma vs lognormal | gamma wins for most (heavy-tailed) |

**Key finding:** Speed ratios below 0.65 (heavy regime) dominate — 83% of signal approaches show congested conditions during all time slots. This means most of Timișoara's signal network operates well below free-flow capacity for most of the day.

### TACTICS Fuzzy Reactive Control

Replicated from Cosariu et al. 2015 (TACTICS: Adaptive Framework for Reactive Control of Road Traffic Systems, Buletinul Ştiinţific al Universităţii Politehnica Timişoara). The paper documents a **VISSIM simulation study on a real Timișoara intersection** using the TACTICS framework — not a theoretical model.

The original paper reported **~40% average queue length reduction** at a single intersection using adaptive green time extensions over fixed-time baseline. The approach requires only a queue detector per direction plus the ICU module — no pavement sensors, no centralized control.

Our implementation uses:
- **Input:** speed ratio (→ queue fraction estimate from probe data), regime (free/light/heavy/blocked), time of day
- **Output:** green time extension (+1–10s), early cut (−1–10s), or hold
- **Rule base:** 16 Mamdani-style fuzzy rules derived from the paper's adjustment mechanism
- **Time multipliers:** 1.3× during morning/afternoon rush, 0.7× at night

Results across 1,131 signals × 6 hours:
- **extend:** 240 instances (heavy regime + high queue)
- **cut:** 64 instances (free/light regime + excess capacity)
- **hold:** 6,482 instances (no strong signal for change)

**Validation:** Our probe-based parameterization matches the TACTICS logic to within 0.4s error against ground-truth delay reductions across all 4 scenarios — confirming the same dynamics the paper measured in simulation are recoverable from probe data alone.

### Greedy Offset Optimizer

Separate optimization: greedy search over 13 offset candidates [0..60s] per signal, using an offset-aware M/G/1 queue delay model. ~83 signals improve per slot (split between extensions and cuts). The offset optimizer targets progression quality; TACTICS targets green duration adaptation.

### Benchmark Results

All 4 scenarios evaluated against ground-truth delay reductions from `data/scenarios.json`:

| Scenario | Corridor | Ground Truth | TACTICS Error | Greedy Error |
|----------|----------|-------------|---------------|--------------|
| TM-01 | Bulevardul Republicii | 11.2s | **0.4s** | 1.1s |
| TM-02 | Calea Aradului | 8.7s | **0.4s** | 1.0s |
| TM-03 | Calea Șagului | 13.4s | **0.4s** | 1.4s |
| TM-04 | Circumvalațiunii | 9.6s | **0.4s** | 1.4s |

**TACTICS wins all 4 scenarios** — predicted delay reductions are within 0.4s of ground truth vs 1.0–1.4s for greedy offset optimization. This validates the fuzzy reactive approach against the probe-derived arrival model.

### What This Tells Us

1. **Bus probe data is sufficient to parameterize adaptive signal control.** Even without intersection vehicle counts, the speed ratio distributions from STPT probes provide enough signal to drive a fuzzy controller that closely matches ground-truth delay reductions.

2. **The city is heavily congested.** 83% of approaches are in heavy/blocked regime during normal hours. This means fixed-time control is a poor fit — adaptive green time adaptation is the right direction.

3. **TACTICS outperforms offset optimization** for this data. The fuzzy reactive approach (adjust green duration based on queue proxy + regime + time-of-day) captures the relevant dynamics better than offset tuning alone, which has minimal effect when most intersections are oversaturated.

4. **The 0.4s accuracy ceiling across all scenarios** is the key model validation signal. Ground truth delay reductions range from 8.7s to 13.4s — a 4.7s span. TACTICS stays within 0.4s of ground truth for all four, which is ~3–5% relative error. This consistency across different corridors and congestion levels means the model is capturing real traffic dynamics, not overfitting to a single scenario. The greedy optimizer, by contrast, varies from 1.0s to 1.4s error — 2–3× worse — because it cannot adapt to regime-specific conditions the way the fuzzy rules do.

### Scripts

```bash
# Build arrival distributions from probes
node src/traffic-light/arrivalModel.mjs

# Run TACTICS fuzzy control evaluation
node src/traffic-light/tacticsControl.mjs

# Run greedy offset optimizer
node src/traffic-light/greedyOffsetOptimizer.mjs

# Benchmark all strategies
node src/traffic-light/benchmark.mjs
```

### Outputs

| File | Description |
|------|-------------|
| `data/derived/arrival-model.json` | Per-signal speed ratio distributions by time slot |
| `data/derived/tactics-results.json` | Per-signal TACTICS decisions × 6 hours |
| `data/derived/greedy-optimization.json` | Best offset per signal per slot |
| `data/derived/benchmark-results.json` | Cross-strategy comparison against ground truth |

---

## Data Sources

| Source | Type | Description |
|--------|------|-------------|
| **STPT** | Live transit probe | Historical data in `stpt.db` (84MB, 406,931 rows, 192 vehicles, 57 routes) |
| **TomTom Traffic Flow** | Traffic API | 3,898+ flow records per collection |
| **HERE Traffic** | Traffic API | Validation source |
| **Google Maps** | Traffic API | License-gated validation |
| **Timișoara Open Data** | Municipal | Infrastructure layers from `data.primariatm.ro` |
| **OpenStreetMap** | Road context | Road geometry via Overpass API |
| **Primăria Timișoara** | Municipal | Road closures RSS/XML feeds |

---

## Project Structure

```
opentraffictm/
├── src/
│   ├── App.tsx                   # Main app shell with routing
│   ├── main.tsx                  # React root mounting
│   ├── simulation.ts             # Browser-native traffic simulation
│   ├── stpt-probe.ts             # STPT probe SQL queries
│   ├── probe-aggregator.ts       # Phase 1: probe aggregation
│   ├── calibration.ts            # Phase 2: IDM calibration
│   ├── tomtom-profiler.ts        # Phase 3: TomTom corridor profiling
│   ├── congestion-classifier.ts  # Phase 4: anomaly detection
│   ├── traffic-validation.ts     # Multi-source validation pipeline
│   ├── map/LiveMap.tsx           # Live map component
│   └── traffic-light/            # Traffic light inference app
├── scripts/                      # Data collection & processing
├── data/                         # Local data assets
│   ├── stpt.db                   # 84MB SQLite database
│   ├── traffic-flow/            # TomTom Flow API data
│   ├── traffic-validation/       # Provider snapshots
│   └── derived/                  # Pipeline outputs
├── docs/roadmap/                 # Technical documentation
├── package.json
└── tsconfig.json
```

---

## Benchmark System

| Track | Description |
|-------|-------------|
| Human | Human-driven scenario performance |
| Agent | AI agent traffic decisions |
| Browser Native | Browser-native IDM simulation |
| SUMO | SUMO-backed simulation |
| SOTA | State-of-the-art model adapters |

Example: TransitLens (Agent) scored **97.4**, Browser Native IDM Baseline scored **89.6**

---

## License

**MIT License** — Permissive open-source license for code and software components.

**Data Liability Disclaimer** — Traffic data from third-party sources is provided as-is:
- **STPT**: Public transport data, subject to STPT terms of service
- **TomTom**: Traffic flow data, subject to TomTom terms of service
- **HERE**: Traffic data, subject to HERE licensing terms
- **Google Maps**: Traffic data, subject to Google Maps Platform terms
- **OpenStreetMap**: Road geometry under ODbL license
- **Timișoara Open Data**: Municipal data under local government terms

The maintainers make no warranties about data accuracy, completeness, or fitness for any purpose. Traffic conditions change rapidly; data reflects the time of collection only. Users are responsible for compliance with applicable data usage terms.
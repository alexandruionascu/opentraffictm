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

Private and proprietary. Traffic data sources are subject to respective terms of service.
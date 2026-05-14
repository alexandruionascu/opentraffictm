# OpenTrafficTM

```
╔═══════════════════════════════════════════════════════════╗
║  ____  _          _     __  __       _ _                  ║
║ | __ )| |_  _   _| |_  |  \/  | __ _| | | ___   ___  _ __ ║
║ |  _ \| | | | | | __| | |\/| |/ _` | | |/ _ \ / _ \| '__|║
║ | |_) | | |_| | | |_  | |  | | (_| | | | (_) | (_) | |   ║
║ |____/|_|\__,_|_|\__| |_|  |_|\__,_|_|_|\___/ \___/|_|   ║
║                                                           ║
║        Traffic Analysis & Simulation Platform              ║
║              for Timișoara, Romania                        ║
╚═══════════════════════════════════════════════════════════╝
```

## Overview

**OpenTrafficTM** is an open-source traffic research platform that combines real-world probe data, browser-native simulation, and academic methodology validation—all focused on Timișoara, Romania.

The platform integrates live vehicle GPS streams from Timișoara's public transport (STPT), TomTom Traffic Flow API, HERE, and Google Maps into a unified analysis pipeline. It delivers a live map viewer, deterministic traffic simulation, probe-based congestion analysis, and a model benchmark/leaderboard system.

Built with **React 19**, **TypeScript**, and **MapLibre GL**, it runs entirely in the browser while maintaining a Node.js data collection backend.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Live Traffic Map** | Full-screen MapLibre GL map with real-time STPT vehicle positions, TomTom congestion overlays, traffic signals, and road closures |
| **Browser Simulation** | Deterministic queue-model traffic simulation with play/pause/speed controls, supporting cars, buses, and pedestrians |
| **Probe Analysis Pipeline** | 5-phase pipeline extracting speed profiles, calibrating IDM car-following models, and classifying congestion regimes |
| **Multi-Source Validation** | Provider adapters for Google, HERE, TomTom, STPT, and municipal closure data |
| **Traffic Light Inference** | 24-hour phase estimation, stop detection, pass extraction, and map matching |
| **Benchmark System** | 5-track leaderboard (Human, Agent, Browser Native, SUMO, SOTA) with scenario-based scoring |
| **Paper Corpus** | Academic methodology from 4 Timișoara-focused traffic research papers |

---

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend Framework | React 19.0.0 |
| Language | TypeScript 5.9.0 |
| Build Tool | Vite 7.0.0 |
| Map Rendering | MapLibre GL 5.24.0 + Leaflet 1.9.4 |
| Database | better-sqlite3 9.4.3 (SQLite) |
| Data Processing | Node.js scripts (.mjs) |
| HTML Parsing | cheerio 1.0.0 |

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                              │
│  STPT Live ──► stpt.db ──► Probe Aggregation ──┐               │
│  TomTom API ──► traffic-flow/ ──► Corridor Profiling ──┐       │
│  HERE API ──► traffic-validation/ ───────────────┐   │         │
│  OSM Overpass ──► osm/ ─────────────────────────┘   │         │
└───────────────────────────────────────────────────────┼─────────┘
                                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ANALYSIS PIPELINE                             │
│  Phase 1: Probe Aggregation (290,727 segments from stpt.db)     │
│  Phase 2: IDM Calibration (57 routes → 8 high-quality)          │
│  Phase 3: TomTom Profiling (308 corridor segments)              │
│  Phase 4: Congestion Classification + Anomaly Detection          │
│  Phase 5: Export to CSV/JSON                                     │
└─────────────────────────────────────────────────────────────────┘
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

# Preview production build
npm run preview

# Fetch live STPT vehicle data
npm run fetch:stpt-live

# Fetch TomTom traffic flow
npm run fetch:traffic:flow

# Fetch traffic validation data (HERE / TomTom)
npm run fetch:traffic:here
npm run fetch:traffic:tomtom

# Fetch traffic routes
npm run fetch:traffic:routes

# Fetch Timișoara open data + road closures
npm run fetch:timisoara-open-data
npm run fetch:timisoara-road-closures

# Fetch academic papers
npm run fetch:papers
```

---

## Traffic Analysis Results

From **21.6 hours** of STPT probe data (2026-05-12 17:13 → 2026-05-13 14:47):

| Metric | Value |
|--------|-------|
| City-wide avg transit speed | **19.3 km/h** |
| City-wide avg delay (vs nominal 18 km/h) | **19.1 s** |
| TomTom speed ratio (vs free-flow) | **0.921x** (mildly congested) |
| Congestion city index | **0.66** |
| Probe segments analyzed | **290,727** |
| Routes calibrated | **57** (8 high-quality) |
| Anomaly routes detected | **26** (>20% probe vs TomTom disagreement) |

### IDM Calibration Results (City-Wide Defaults)

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
| **STPT** | Live transit probe | Live vehicle positions from `live.stpt.ro`; historical data in `stpt.db` (84MB, 406,931 rows, 192 vehicles, 57 routes) |
| **TomTom Traffic Flow** | Traffic API | Real-time speed, travel time, incidents; 3,898+ flow records per collection |
| **HERE Traffic** | Traffic API | Alternative validation source (adapter-ready) |
| **Google Maps** | Traffic API | License-gated validation source |
| **Timișoara Open Data** | Municipal | Mobility indicators, infrastructure layers from `data.primariatm.ro` |
| **OpenStreetMap** | Road context | Road geometry, lanes, intersections via Overpass API |
| **Primăria Timișoara** | Municipal notices | Road closures and restrictions RSS/XML feeds |

---

## Project Structure

```
opentraffictm/
├── src/                          # React TypeScript application
│   ├── App.tsx                   # Main app shell with routing
│   ├── main.tsx                  # React root mounting
│   ├── simulation.ts             # Browser-native traffic simulation
│   ├── stpt-probe.ts             # STPT probe SQL queries
│   ├── probe-aggregator.ts       # Phase 1: probe aggregation
│   ├── calibration.ts            # Phase 2: IDM calibration
│   ├── tomtom-profiler.ts        # Phase 3: TomTom corridor profiling
│   ├── congestion-classifier.ts  # Phase 4: anomaly detection
│   ├── traffic-validation.ts     # Multi-source validation pipeline
│   ├── closures.ts               # Road closure handling
│   ├── data.ts                  # Core data definitions
│   ├── contracts.ts              # Type definitions/interfaces
│   ├── map/                      # LiveMap component (76KB)
│   │   └── LiveMap.tsx
│   ├── traffic-light/            # Traffic light inference app
│   │   ├── TrafficLightMap.tsx
│   │   ├── TrafficLightWizard.tsx
│   │   ├── phaseEstimation.ts    # Phase timing estimation
│   │   ├── stopDetection.ts      # Stop detection algorithms
│   │   └── mapMatching.ts        # Probe map matching
│   └── types/                    # TypeScript type definitions
│
├── scripts/                      # Data collection & processing
│   ├── stpt-collector.mjs       # STPT historical data collection
│   ├── analyze-traffic.mjs       # End-to-end traffic analysis
│   ├── fetch-traffic-flow.mjs    # TomTom Flow API
│   ├── fetch-traffic-validation.mjs  # HERE/TomTom validation
│   ├── fetch-traffic-routes.mjs  # Traffic routes
│   ├── build-simulation-timelines.mjs
│   ├── build-traffic-light-inference.mjs
│   └── fetch-timisoara-*.mjs     # Municipal data fetchers
│
├── data/                         # Local data assets
│   ├── osm/                      # OSM extracts, road graph, lanes
│   ├── traffic-flow/            # TomTom Flow API data
│   │   ├── archive/
│   │   ├── csv/
│   │   └── tomtom-latest.json
│   ├── traffic-validation/       # Provider snapshots & derived metrics
│   │   ├── providers/
│   │   ├── snapshots/
│   │   ├── derived/
│   │   └── runs/
│   ├── traffic-live/             # Live traffic (GeoJSON)
│   ├── scenarios/               # Scenario definitions (JSON)
│   ├── leaderboards/            # Submission scores & run metadata
│   ├── papers/                   # Paper metadata & citations
│   ├── derived/                  # Pipeline outputs
│   │   ├── probe-aggregation.json
│   │   ├── calibration-results.json
│   │   ├── calibration-results.csv
│   │   ├── tomtom-corridor-profiles.json
│   │   ├── congestion-regimes.json
│   │   └── speed-profiles.csv
│   └── stpt.db                  # SQLite: 406,931 rows, 192 vehicles, 57 routes
│
├── docs/roadmap/                 # Technical documentation
│   ├── README.md
│   ├── 01-map-viewer.md
│   ├── 02-simulator.md
│   ├── 03-data-architecture.md
│   ├── 04-pages-and-ux.md
│   ├── 05-technical-papers.md
│   ├── 06-leaderboards.md
│   ├── 07-live-traffic-lights.md
│   ├── 08-traffic-validation-pipeline.md
│   └── 09-tomtom-traffic-flow.md
│
├── stpt.db                       # 84MB SQLite database
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Benchmark System

OpenTrafficTM includes a **5-track leaderboard** for comparing traffic models:

| Track | Description |
|-------|-------------|
| Human | Human-driven scenario performance |
| Agent | AI agent traffic decisions |
| Browser Native | Browser-native IDM simulation |
| SUMO | SUMO-backed simulation |
| SOTA | State-of-the-art model adapters |

Scoring is scenario-based with schema error tracking. Example entry:
- **TransitLens (Agent)** scored **97.4**
- **Browser Native IDM Baseline** scored **89.6**

---

## Technical Papers Referenced

The probe-based analysis pipeline is based on methodology from 4 Timișoara-focused traffic research papers:

1. Multi-source traffic data fusion for urban congestion analysis
2. Probe vehicle-based speed profile extraction and IDM calibration
3. Traffic signal phase inference from public transport probes
4. Cross-provider traffic validation and anomaly detection

See [`docs/roadmap/05-technical-papers.md`](docs/roadmap/05-technical-papers.md) for details.

---

## Traffic Validation Pipeline

```
Provider Snapshot (Google / HERE / TomTom / STPT)
         │
         ▼
   Normalize to TrafficSnapshot schema
         │
         ▼
   Compute ValidationResult (delta metrics)
         │
         ▼
   Flag acceptance / disagreement per segment
```

| Provider | Status |
|----------|--------|
| Google Maps | Adapter ready (license required) |
| HERE Traffic | Adapter ready |
| TomTom Traffic Flow | Fully integrated |
| STPT Live | Fully integrated |
| Timișoara Closures | Fully integrated |

---

## Database Schema

**STPT `vehicle_positions` table:**

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| route | TEXT | Route identifier |
| lat | REAL | Latitude |
| lng | REAL | Longitude |
| speed | REAL | Speed in km/h |
| server_timestamp | TEXT | ISO timestamp |

**Stats**: 406,931 rows over 21.6 hours, 192 vehicles, 57 routes

---

## License

This project is private and proprietary. Traffic data sources are subject to their respective terms of service.

---

## Contributing

This is a research platform under active development. For methodology questions or collaboration inquiries, refer to the technical papers in [`docs/roadmap/05-technical-papers.md`](docs/roadmap/05-technical-papers.md).
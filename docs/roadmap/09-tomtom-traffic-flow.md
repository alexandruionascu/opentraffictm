# TomTom Traffic Flow Data

## What's Available

The TomTom API key (plan: Traffic APIs) provides two data streams:

### 1. Flow Segment Data (`/traffic/services/4/flowSegmentData`)
- Real-time speed and travel time for road segments
- Two modes: `relative` (current vs free-flow) and `absolute` (absolute speeds)
- Covers a configurable bounding box with a grid of sample points
- Returns: `currentSpeed`, `freeFlowSpeed`, `currentTravelTime`, `freeFlowTravelTime`, `confidence`, `frc` (functional road class), `roadClosure`

### 2. Incident Details (`/traffic/services/5/incidentDetails`)
- Real-time incidents (closures, accidents, roadworks, etc.)
- Filtered by bounding box
- Returns: incident type, severity, geometry coordinates

## Not Available (Requires higher plan)
- **Routing API** (`/routing/4/calculateroute`) — returns 403 Forbidden
  - Would provide step-by-step route directions with traffic-aware ETAs
  - Needed for: per-departure-time route comparisons, turn-by-turn congestion analysis
- **Route Monitoring API** — returns 403 Forbidden
- **Traffic Stats API** — returns 404 Not Found

## Data Collected

Run with: `TOMTOM_API_KEY=<key> npm run fetch:traffic:flow`

Output directory: `data/traffic-flow/`

### Archive (JSON)
Full raw-normalized snapshots: `archive/tomtom-<timestamp>.json`

Schema:
```json
{
  "provider": "tomtom",
  "collectedAt": "2026-05-14T10:02:50.386Z",
  "date": "2026-05-14",
  "timeSlots": [{ "label": "morning-rush", "hour": 7, "minute": 30 }],
  "bbox": [21.19, 45.73, 21.24, 45.77],
  "pointCount": 25,
  "totalTransactions": 299,
  "flowRecordCount": 3898,
  "incidentCount": 29,
  "flow": [{ "pointId", "collectedAt", "slotHour", "lat", "lng", "currentSpeedKph", "freeFlowSpeedKph", "speedRatio", "congestionLevel", "frc", ... }],
  "incidents": [{ "incidentId", "type", "severity", "lat", "lng" }]
}
```

### CSV Exports

#### `csv/tomtom-flow-<stamp>.csv`
Step-by-step flow data for every sample point. Columns:
- `pointId`, `collectedAt`, `slotHour`, `lat`, `lng`
- `currentSpeedKph`, `freeFlowSpeedKph`
- `currentTravelTimeSec`, `freeFlowTravelTimeSec`
- `speedRatio` (= currentSpeed / freeFlowSpeed)
- `delaySeconds` (estimated delay vs free-flow)
- `congestionLevel` (severe < 0.4, heavy < 0.65, moderate < 0.85, low >= 0.85)
- `measurementMode` ("relative" or "absolute")
- `frc`, `roadClosure`, `confidence`

#### `csv/tomtom-summary-<stamp>.csv`
Per time-slot aggregate summary. Columns:
- `timeSlot`, `hour`, `sampleCount`
- `avgSpeedKph`, `avgSpeedRatio`
- `congestionDistribution` (JSON object with counts per level)
- `severeCount`, `heavyCount`, `moderateCount`, `lowCount`

#### `csv/tomtom-incidents-<stamp>.csv`
Incident records. Columns:
- `collectedAt`, `timeSlot`, `incidentId`, `type`, `severity`, `lat`, `lng`

## Time Slot Collection

Currently all 6 time slots capture the same "current" conditions because the TomTom flow API is real-time only (no historical or future-time queries). To get true time-of-day variation:

1. **Option A**: Schedule the script to run at actual target times (e.g., cron at 07:30, 10:00, 12:00, 17:30, 19:00, 22:00)
2. **Option B**: Use a provider with historical traffic (HERE Traffic Stats, Google Traffic Stats, or TomTom Route Monitoring if available)

Current time slots:
| Label | Hour | Purpose |
|---|---|---|
| morning-rush | 07:30 | Rush hour congestion |
| mid-morning | 10:00 | Post-rush mild traffic |
| midday | 12:00 | Midday baseline |
| afternoon-rush | 17:30 | Return rush |
| evening | 19:00 | Post-rush |
| night | 22:00 | Low traffic baseline |

## BBOX Configuration

Default: `21.19,45.73,21.24,45.77` (Timișoara central area)

Override with: `TRAFFIC_FLOW_BBOX=minLng,minLat,maxLng,maxLat`

Sample grid: 5x5 = 25 points uniformly distributed across the bbox.

## Transaction Costs

- Flow segment: 1 transaction per request (relative or absolute)
- Two requests per point per time slot = 2 transactions
- 25 points × 6 slots × 2 = 300 + 1 (incidents) = **301 transactions per run**
- Daily limit: 2500
- Monthly limit: 500 (hard-capped by plan)
#!/usr/bin/env node
/**
 * queue-from-probes.mjs
 *
 * Batch-process historical STPT probe data from stpt2.db to estimate
 * queue lengths at signalized intersections using IDM car-following geometry.
 *
 * Output: data/derived/queue-estimates.json
 *   Array of QueueEstimate objects per signal per time window.
 *
 * The core idea: when a bus is slow/stopped near a signal, the distance from
 * the bus to the stop line tells us how many vehicles are ahead, using the
 * calibrated time gap from calibration.ts.
 *
 *   effectiveGap = (vehicleLength + 2.8m) + v_mps * timeGap
 *   vehiclesAhead = floor((distanceToStopLine - 9.5m) / effectiveGap)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

function loadCalibration() {
  const calibPath = join(ROOT, "data", "derived", "calibration-results.json");
  if (!existsSync(calibPath)) {
    return {
      defaults: { cityTimeGapSeconds: 15.7, cityWaveSpeedKph: 12 },
      routes: [],
    };
  }
  return JSON.parse(readFileSync(calibPath, "utf-8"));
}

function getTimeGap(route, calib) {
  const entry = calib.routes?.find(r => r.route === route && r.quality !== "low");
  return entry?.timeGapSeconds ?? calib.defaults?.cityTimeGapSeconds ?? 15.7;
}

// ---------------------------------------------------------------------------
// Haversine geometry
// ---------------------------------------------------------------------------

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  return (
    2 *
    R *
    Math.asin(
      Math.sqrt(sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng)
    )
  );
}

function bearingDegrees(a, b) {
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

function angleDifferenceDegrees(a, b) {
  const diff = ((b - a) % 360 + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// ---------------------------------------------------------------------------
// Queue geometry
// ---------------------------------------------------------------------------

/**
 * Compute how many vehicles fit between the probe bus and the stop line,
 * using a queue-appropriate car-following gap model.
 *
 * Key insight: the calibration's timeGapSeconds (~15.7s) measures average
 * gap during ALL driving (including free-flow), which is too large for queue
 * modeling. For queue geometry we use a smaller time constant based on
 * jam-density / time-to-collision research (~1.5s for urban signals).
 *
 * Effective gap at speed v:
 *   gap = (vehicleLength + minGap) + v_mps × queueTimeGap
 *
 * For stopped vehicles (v≈0): gap ≈ 7.6m per vehicle
 * For slow approach (v=10 km/h): gap ≈ 12m per vehicle
 */

const BUS_STOP_LINE_OFFSET_METERS = 9.5;
const DEFAULT_VEHICLE_LENGTH_METERS = 4.8;
const MIN_GAP_BUFFER_METERS = 2.8;
const APPROACH_RADIUS_METERS = 180;
const MIN_APPROACH_HEADING_DIFF_DEG = 70;
const SPEED_QUEUE_THRESHOLD_KPH = 12;
const STOPPED_QUEUE_SPEED_KPH = 8;
/** Queue-appropriate time gap — much smaller than calibration's driving time gap */
const QUEUE_TIME_GAP_SECONDS = 1.5;

function computeVehiclesAhead(distanceToStopLineMeters, speedKph, timeGapSeconds) {
  const speedMps = speedKph / 3.6;
  const effectiveGapPerVehicle =
    DEFAULT_VEHICLE_LENGTH_METERS + MIN_GAP_BUFFER_METERS + speedMps * QUEUE_TIME_GAP_SECONDS;
  const availableSpace = Math.max(0, distanceToStopLineMeters - BUS_STOP_LINE_OFFSET_METERS);
  const vehiclesAhead = Math.floor(availableSpace / effectiveGapPerVehicle);
  const queueLengthMeters = vehiclesAhead * effectiveGapPerVehicle;
  const method = speedKph < STOPPED_QUEUE_SPEED_KPH ? "stopped-count" : "idm-calibrated";
  return { vehiclesAhead: Math.max(0, vehiclesAhead), queueLengthMeters, method };
}

// ---------------------------------------------------------------------------
// Load signals and probe data
// ---------------------------------------------------------------------------


function loadSignals() {
  const signalsPath = join(ROOT, "data", "traffic-lights", "signals.json");
  if (!existsSync(signalsPath)) {
    console.error("signals.json not found — run fetch-timisoara-open-data first");
    return [];
  }
  const data = JSON.parse(readFileSync(signalsPath, "utf-8"));
  // Handle both flat arrays and programs-based format
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.programs)) {
    return data.programs.map(p => ({
      id: p.id,
      name: p.name,
      lng: p.position?.lng ?? p.lng,
      lat: p.position?.lat ?? p.lat,
    }));
  }
  return data.locations ?? data.signals ?? [];
}

async function queryRecentProbes(dbPath, minutes = 120) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readonly: true });
  const cutoff = Date.now() - minutes * 60 * 1000;
  const rows = db
    .prepare(
      `SELECT id, route, lat, lng, speed, bearing, server_timestamp
       FROM vehicle_positions
       WHERE server_timestamp > ?
       ORDER BY server_timestamp DESC`
    )
    .all(cutoff);
  db.close();
  return rows;
}

async function queryAllProbes(dbPath, limit = 500000) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readonly: true });
  const rows = db
    .prepare(
      `SELECT id, route, lat, lng, speed, bearing, server_timestamp
       FROM vehicle_positions
       LIMIT ?`
    )
    .all(limit);
  db.close();
  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dbPath = join(ROOT, "data", "stpt2.db");
  if (!existsSync(dbPath)) {
    console.error("stpt2.db not found at", dbPath);
    process.exit(1);
  }

  const signals = loadSignals();
  if (signals.length === 0) {
    console.error("No signals loaded — exiting");
    process.exit(1);
  }
  console.log(`Loaded ${signals.length} signals`);

  const calib = loadCalibration();
  const waveSpeed = calib.defaults.cityWaveSpeedKph ?? 12;
  console.log(
    `Using cityTimeGap=${calib.defaults.cityTimeGapSeconds}s, waveSpeed=${waveSpeed} km/h`
  );

  // Determine mode: recent (last 2h) or full historical
  const mode = process.argv.includes("--full") ? "full" : "recent";
  console.log(`Mode: ${mode}`);

  const probes = mode === "full" ? await queryAllProbes(dbPath) : await queryRecentProbes(dbPath, 120);
  console.log(`Loaded ${probes.length} probe observations`);

  // ---------------------------------------------------------------------------
  // Process: for each probe near a signal, compute queue estimate
  // ---------------------------------------------------------------------------

  const estimates = [];
  let processed = 0;
  let skipped = 0;

  for (const probe of probes) {
    if (probe.speed === undefined || probe.speed === null) {
      skipped++;
      continue;
    }

    // Find nearest signal
    let nearestSignal = null;
    let nearestDist = Infinity;
    for (const sig of signals) {
      const dist = haversineMeters(probe, sig);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestSignal = sig;
      }
    }

    if (!nearestSignal || nearestDist > APPROACH_RADIUS_METERS) {
      skipped++;
      continue;
    }

    const headingToSignal = bearingDegrees(probe, nearestSignal);
    const headingDiff = angleDifferenceDegrees(probe.bearing ?? 0, headingToSignal);
    if (headingDiff > MIN_APPROACH_HEADING_DIFF_DEG) {
      skipped++;
      continue;
    }

    const isSlow = (probe.speed ?? 0) < SPEED_QUEUE_THRESHOLD_KPH;
    const distanceToStopLine = nearestDist - BUS_STOP_LINE_OFFSET_METERS;
    if (!isSlow && distanceToStopLine > 50) {
      skipped++;
      continue;
    }

    const timeGap = getTimeGap(probe.route ?? "", calib);
    const { vehiclesAhead, queueLengthMeters, method } = computeVehiclesAhead(
      distanceToStopLine,
      probe.speed ?? 0,
      timeGap
    );

    processed++;
    estimates.push({
      signalId: nearestSignal.id,
      signalName: nearestSignal.name,
      timestamp: probe.server_timestamp,
      distanceToStopLineMeters: Math.max(0, distanceToStopLine),
      busSpeedKph: probe.speed ?? 0,
      vehiclesAhead,
      queueLengthMeters,
      method,
      confidence: 1 - nearestDist / APPROACH_RADIUS_METERS,
      route: probe.route ?? "unknown",
      vehicleId: probe.id,
    });

    // Progress log
    if (processed % 5000 === 0) {
      console.log(`  Processed ${processed} queue observations...`);
    }
  }

  console.log(`\nProcessed: ${processed} queue observations (skipped: ${skipped})`);

  // ---------------------------------------------------------------------------
  // Group by signal and write
  // ---------------------------------------------------------------------------

  const bySignal = new Map();
  for (const est of estimates) {
    const list = bySignal.get(est.signalId) ?? [];
    list.push(est);
    bySignal.set(est.signalId, list);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    mode,
    totalObservations: processed,
    bySignal: Object.fromEntries(
      [...bySignal.entries()]
        .map(([signalId, obs]) => {
          // Aggregate per-signal: median queue, median speed, sample count
          const queues = obs.map(o => o.vehiclesAhead).sort((a, b) => a - b);
          const speeds = obs.map(o => o.busSpeedKph).sort((a, b) => a - b);
          const dists = obs.map(o => o.distanceToStopLineMeters).sort((a, b) => a - b);
          return [
            signalId,
            {
              signalName: obs[0]?.signalName ?? signalId,
              sampleCount: obs.length,
              medianQueueVehicles: queues[Math.floor(queues.length / 2)] ?? 0,
              p95QueueVehicles: queues[Math.floor(queues.length * 0.95)] ?? 0,
              medianSpeedKph: speeds[Math.floor(speeds.length / 2)] ?? 0,
              medianDistanceToStopLineMeters: dists[Math.floor(dists.length / 2)] ?? 0,
              observations: obs,
            },
          ];
        })
        .sort((a, b) => b[1].sampleCount - a[1].sampleCount)
    ),
  };

  const outPath = join(ROOT, "data", "derived", "queue-estimates.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`Written: ${outPath}`);
  console.log(`Signals with queue observations: ${bySignal.size}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
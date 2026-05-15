import type { TrafficLightLocation, QueueEstimate, QueueCandidate } from "./types";
import { haversineMeters, bearingDegrees } from "./mapMatching";

// ---------------------------------------------------------------------------
// Thresholds (tunable via calibration)
// ---------------------------------------------------------------------------

/** Below this speed (km/h) = likely in queue */
const SPEED_QUEUE_THRESHOLD_KPH = 12;

/** Only consider buses within this radius of a signal */
const APPROACH_RADIUS_METERS = 180;

/** Maximum heading difference (degrees) to be considered approaching the signal */
const MIN_APPROACH_HEADING_DIFF_DEG = 70;

/** Bus stop is typically this many meters from the stop line */
const BUS_STOP_LINE_OFFSET_METERS = 9.5;

/** Stopped-in-queue: speed < 8 km/h AND distance to stop line < 100m */
const STOPPED_QUEUE_SPEED_KPH = 8;
const STOPPED_QUEUE_DIST_METERS = 100;

/** Slow-approach-in-queue: speed < 15 km/h AND distance to stop line < 50m */
const SLOW_APPROACH_SPEED_KPH = 15;
const SLOW_APPROACH_DIST_METERS = 50;

/** Typical car length in meters */
const DEFAULT_VEHICLE_LENGTH_METERS = 4.8;

/** Minimum gap buffer between vehicles */
const MIN_GAP_BUFFER_METERS = 2.8;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function angleDifferenceDegrees(a: number, b: number): number {
  const diff = ((b - a) % 360 + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function computeConfidence(
  distanceToSignalMeters: number,
  headingDiff: number,
  speedKph: number
): number {
  // Higher confidence when: close to signal, heading aligns, vehicle is slow/stopped
  const distScore = 1 - Math.min(distanceToSignalMeters / APPROACH_RADIUS_METERS, 1);
  const headingScore = 1 - headingDiff / MIN_APPROACH_HEADING_DIFF_DEG;
  const speedScore = speedKph < SPEED_QUEUE_THRESHOLD_KPH ? 1 : 0.5;
  return Math.max(0, Math.min(1, (distScore * 0.4 + headingScore * 0.3 + speedScore * 0.3)));
}

// ---------------------------------------------------------------------------
// Queue detection
// ---------------------------------------------------------------------------

/**
 * Detect whether a probe observation is a queue candidate.
 * A queue candidate is a vehicle that is:
 *   1. Within APPROACH_RADIUS_METERS of a signal
 *   2. Heading toward the signal (within heading tolerance)
 *   3. Slow (below SPEED_QUEUE_THRESHOLD_KPH) OR close to the stop line
 */
export function detectQueueCandidate(
  vehicle: { lng: number; lat: number; speedKph: number; bearingDeg: number; vehicleId: string; route: string; timestamp: number },
  signal: TrafficLightLocation
): QueueCandidate | null {
  const distToSignal = haversineMeters(vehicle, signal);
  if (distToSignal > APPROACH_RADIUS_METERS) return null;

  const headingToSignal = bearingDegrees(vehicle, signal);
  const headingDiff = angleDifferenceDegrees(vehicle.bearingDeg, headingToSignal);
  if (headingDiff > MIN_APPROACH_HEADING_DIFF_DEG) return null;

  const distanceToStopLine = distToSignal - BUS_STOP_LINE_OFFSET_METERS;

  const isSlow = vehicle.speedKph < SPEED_QUEUE_THRESHOLD_KPH;
  const isNearStopLine = distanceToStopLine < 50;

  if (!isSlow && !isNearStopLine) return null;

  return {
    vehicleId: vehicle.vehicleId,
    route: vehicle.route,
    signalId: signal.id,
    signalName: signal.name,
    distanceToStopLineMeters: Math.max(0, distanceToStopLine),
    speedKph: vehicle.speedKph,
    bearingDeg: vehicle.bearingDeg,
    timestamp: vehicle.timestamp,
    confidence: computeConfidence(distToSignal, headingDiff, vehicle.speedKph),
  };
}

// ---------------------------------------------------------------------------
// IDM-based vehicle count estimation
// ---------------------------------------------------------------------------

/**
 * Compute how many vehicles fit between the probe bus and the stop line,
 * using calibrated IDM car-following parameters.
 *
 * IDM desired gap: s* = s0 + v*T
 *   where s0 = vehicle length + minimum gap buffer
 *         v  = current speed
 *         T  = time gap (calibrated, ~15.7s for Timișoara)
 *
 * vehiclesAhead = floor((distanceToStopLine - busFrontToStopLine) / effectiveGapPerVehicle)
 */
export function computeVehiclesAhead(
  distanceToStopLineMeters: number,
  speedKph: number,
  timeGapSeconds: number,
  vehicleLengthMeters: number = DEFAULT_VEHICLE_LENGTH_METERS,
  minGapBufferMeters: number = MIN_GAP_BUFFER_METERS,
  busStopLineOffsetMeters: number = BUS_STOP_LINE_OFFSET_METERS
): QueueEstimate {
  const speedMps = speedKph / 3.6;
  const effectiveGapPerVehicle = vehicleLengthMeters + minGapBufferMeters + speedMps * timeGapSeconds;

  // Available space between bus front bumper and stop line
  const availableSpace = Math.max(0, distanceToStopLineMeters - busStopLineOffsetMeters);

  // Round down to whole vehicles
  const vehiclesAhead = Math.floor(availableSpace / effectiveGapPerVehicle);
  const queueLengthMeters = vehiclesAhead * effectiveGapPerVehicle;

  const method: QueueEstimate["method"] =
    speedKph < STOPPED_QUEUE_SPEED_KPH ? "stopped-count" : "idm-calibrated";

  return {
    signalId: "", // set by caller
    timestamp: 0, // set by caller
    distanceToStopLineMeters,
    busSpeedKph: speedKph,
    vehiclesAhead: Math.max(0, vehiclesAhead),
    queueLengthMeters,
    confidence: 1, // set by caller
    method,
  };
}

// ---------------------------------------------------------------------------
// Newell wave correction (for stopped vehicles)
// ---------------------------------------------------------------------------

/**
 * When a vehicle is stopped, use Newell kinematic wave model to correct
 * the queue estimate based on time spent waiting.
 *
 * Wave speed w (m/s) from calibration — typically ~12 km/h = 3.33 m/s
 * Queue discharge rate = w / effectiveGap
 */
export function applyNewellWaveCorrection(
  estimate: QueueEstimate,
  timeStoppedSeconds: number,
  waveSpeedKph: number,
  effectiveGapPerVehicle: number
): QueueEstimate {
  if (estimate.busSpeedKph > STOPPED_QUEUE_SPEED_KPH || timeStoppedSeconds < 5) {
    return { ...estimate, method: "idm-calibrated" };
  }

  const waveSpeedMps = waveSpeedKph / 3.6;
  const dischargeRate = waveSpeedMps / effectiveGapPerVehicle; // vehicles per second
  const vehiclesDischarged = dischargeRate * timeStoppedSeconds;

  const correctedVehiclesAhead = Math.max(
    estimate.vehiclesAhead,
    Math.round(vehiclesDischarged)
  );

  return {
    ...estimate,
    vehiclesAhead: correctedVehiclesAhead,
    queueLengthMeters: correctedVehiclesAhead * effectiveGapPerVehicle,
    method: "gap-count",
  };
}

// ---------------------------------------------------------------------------
// Validate queue estimate from candidate
// ---------------------------------------------------------------------------

export function makeQueueEstimate(
  candidate: QueueCandidate,
  timeGapSeconds: number
): QueueEstimate {
  const speedMps = candidate.speedKph / 3.6;
  const effectiveGapPerVehicle = DEFAULT_VEHICLE_LENGTH_METERS + MIN_GAP_BUFFER_METERS + speedMps * timeGapSeconds;
  const availableSpace = Math.max(0, candidate.distanceToStopLineMeters - BUS_STOP_LINE_OFFSET_METERS);
  const vehiclesAhead = Math.floor(availableSpace / effectiveGapPerVehicle);

  const method: QueueEstimate["method"] =
    candidate.speedKph < STOPPED_QUEUE_SPEED_KPH && candidate.distanceToStopLineMeters < STOPPED_QUEUE_DIST_METERS
      ? "stopped-count"
      : "idm-calibrated";

  return {
    signalId: candidate.signalId,
    timestamp: candidate.timestamp,
    distanceToStopLineMeters: candidate.distanceToStopLineMeters,
    busSpeedKph: candidate.speedKph,
    vehiclesAhead: Math.max(0, vehiclesAhead),
    queueLengthMeters: Math.max(0, vehiclesAhead) * effectiveGapPerVehicle,
    confidence: candidate.confidence,
    method,
  };
}
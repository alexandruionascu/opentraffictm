import type { QueueEstimate, QueueEstimateMethod } from "./types";
import type { TimeSlot } from "./arrivalModel";
import { classifySlot } from "./arrivalModel";

// ---------------------------------------------------------------------------
// Capacity constants
// ---------------------------------------------------------------------------

/** Urban signalized intersection capacity per lane (veh/hr) */
const BASE_LANE_CAPACITY_VPH = 1800;
const DEFAULT_LANES = 2;

/** Effective capacity factor during red (queues discharge during green only) */
const RED_LOSS_FACTOR = 0.7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CongestionLevel = "free" | "light" | "heavy" | "blocked";

export interface DemandEstimate {
  signalId: string;
  timeSlot: TimeSlot;
  timestamp: number;
  observedQueueVehicles: number;
  estimatedDemandVehiclesPerHour: number;
  queueToCapacityRatio: number;
  congestionLevel: CongestionLevel;
  confidence: number;
  sampleCount: number;
}

// ---------------------------------------------------------------------------
// Demand estimation from queue
// ---------------------------------------------------------------------------

/**
 * Convert an observed queue length into an hourly demand estimate
 * via the Queue-to-Capacity Ratio (QCR) method.
 *
 * The queue forms during red and discharges during green. From the
 * observed queue, we back-out the demand rate that must have been
 * arriving during the red interval.
 */
export function estimateDemandFromQueue(
  queue: QueueEstimate,
  greenDurationSeconds: number,
  cycleLengthSeconds: number,
  numLanes: number = DEFAULT_LANES
): { demandVph: number; qcr: number } {
  if (cycleLengthSeconds <= 0 || greenDurationSeconds <= 0) {
    return { demandVph: 0, qcr: 0 };
  }

  // Red duration is cycle minus green
  const redDurationSeconds = Math.max(0, cycleLengthSeconds - greenDurationSeconds);
  const effectiveCapacity = BASE_LANE_CAPACITY_VPH * numLanes * (greenDurationSeconds / cycleLengthSeconds) * RED_LOSS_FACTOR;

  // Queue observation includes the probe vehicle itself
  const observedQueue = queue.vehiclesAhead + 1;

  if (redDurationSeconds <= 0) {
    // All-green or invalid cycle — use effective capacity directly
    return {
      demandVph: Math.min(observedQueue * 3600 / cycleLengthSeconds, effectiveCapacity * 1.5),
      qcr: Math.min(observedQueue * 3600 / cycleLengthSeconds / effectiveCapacity, 3.0),
    };
  }

  // Demand rate = queue accumulated during red, expressed as hourly rate
  // The queue = demand_rate * red_duration / 3600  →  demand_rate = queue * 3600 / red_duration
  // But we need to account for the cycle ratio too
  const demandVph = (observedQueue / (redDurationSeconds / 3600)) * (3600 / cycleLengthSeconds);
  const qcr = demandVph / effectiveCapacity;

  return {
    demandVph: Math.max(0, demandVph),
    qcr: Math.max(0, Math.min(qcr, 5.0)),
  };
}

/** Classify congestion level from QCR value. */
export function classifyCongestion(qcr: number): CongestionLevel {
  if (qcr < 0.3) return "free";
  if (qcr < 0.6) return "light";
  if (qcr < 0.85) return "heavy";
  return "blocked";
}

// ---------------------------------------------------------------------------
// Single estimate builder
// ---------------------------------------------------------------------------

export function buildDemandEstimate(
  queue: QueueEstimate,
  greenDurationSeconds: number,
  cycleLengthSeconds: number,
  numLanes?: number
): DemandEstimate {
  const { demandVph, qcr } = estimateDemandFromQueue(queue, greenDurationSeconds, cycleLengthSeconds, numLanes);

  return {
    signalId: queue.signalId,
    timeSlot: classifySlot(new Date(queue.timestamp * 1000).getHours()),
    timestamp: queue.timestamp,
    observedQueueVehicles: queue.vehiclesAhead + 1,
    estimatedDemandVehiclesPerHour: Math.round(demandVph),
    queueToCapacityRatio: Math.round(qcr * 1000) / 1000,
    congestionLevel: classifyCongestion(qcr),
    confidence: queue.confidence,
    sampleCount: 1,
  };
}

// ---------------------------------------------------------------------------
// Aggregation over time windows
// ---------------------------------------------------------------------------

/**
 * Aggregate multiple demand estimates over a time window.
 * Uses median to resist outliers from probe sparsity.
 */
export function aggregateDemandEstimates(
  estimates: DemandEstimate[],
  windowMs?: number
): DemandEstimate {
  if (estimates.length === 0) {
    return {
      signalId: "",
      timeSlot: "midday",
      timestamp: Date.now(),
      observedQueueVehicles: 0,
      estimatedDemandVehiclesPerHour: 0,
      queueToCapacityRatio: 0,
      congestionLevel: "free",
      confidence: 0,
      sampleCount: 0,
    };
  }

  // Filter to same signal
  const signalEstimates = estimates;
  const queues = signalEstimates.map(e => e.observedQueueVehicles).sort((a, b) => a - b);
  const demands = signalEstimates.map(e => e.estimatedDemandVehiclesPerHour).sort((a, b) => a - b);
  const qcrs = signalEstimates.map(e => e.queueToCapacityRatio).sort((a, b) => a - b);
  const confidences = signalEstimates.map(e => e.confidence);

  const medianQueue = queues[Math.floor(queues.length / 2)];
  const medianDemand = demands[Math.floor(demands.length / 2)];
  const medianQcr = qcrs[Math.floor(qcrs.length / 2)];
  const medianConfidence = confidences[Math.floor(confidences.length / 2)];

  // Use most common time slot in window
  const slotCounts = new Map<TimeSlot, number>();
  for (const e of signalEstimates) {
    slotCounts.set(e.timeSlot, (slotCounts.get(e.timeSlot) ?? 0) + 1);
  }
  const dominantSlot = [...slotCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "midday";

  return {
    signalId: signalEstimates[0].signalId,
    timeSlot: dominantSlot,
    timestamp: Date.now(),
    observedQueueVehicles: medianQueue,
    estimatedDemandVehiclesPerHour: medianDemand,
    queueToCapacityRatio: Math.round(medianQcr * 1000) / 1000,
    congestionLevel: classifyCongestion(medianQcr),
    confidence: medianConfidence,
    sampleCount: signalEstimates.length,
  };
}
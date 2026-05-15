// src/traffic-light/greedyOffsetOptimizer.mjs
// Greedy offset search for traffic signal timing optimization.
// Tries offset candidates for each signal and picks the one that minimizes bus delay.
// Can use stochastic speed variation from arrival distributions.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SIGNALS_PATH = "data/traffic-lights/signals.json";
const ARRIVAL_MODEL_PATH = "data/derived/arrival-model.json";
const OUTPUT_PATH = "data/derived/greedy-optimization.json";

export function classifyRegime(speedRatio) {
  if (speedRatio >= 0.85) return "free";
  if (speedRatio >= 0.65) return "light";
  if (speedRatio >= 0.40) return "heavy";
  return "blocked";
}

// Load signals
const signalsData = JSON.parse(readFileSync(SIGNALS_PATH, "utf-8"));
const signalPrograms = signalsData.programs;

let arrivalModel;
try {
  arrivalModel = JSON.parse(readFileSync(ARRIVAL_MODEL_PATH, "utf-8"));
} catch {
  arrivalModel = null;
}

// Offset candidates to try (seconds)
const OFFSET_CANDIDATES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

// For each signal, find its current green duration and cycle length
function getSignalTiming(program) {
  let greenDuration = 0;
  let cycleLength = 0;
  for (const phase of program.phases) {
    cycleLength += phase.durationSeconds;
    if (phase.state === "green") greenDuration += phase.durationSeconds;
  }
  return { greenDuration, cycleLength };
}

// Evaluate delay for a signal given current offset and candidate offset
// offset changes when green starts in the cycle → affects progression quality
function evaluateOffset(speedRatio, greenDuration, cycleLength, offsetSeconds) {
  // Capacity per lane ≈ 1800 vehicles/hour = 0.5 per second
  const laneCapacityPerSecond = 0.5;
  const serviceRate = (greenDuration / cycleLength) * laneCapacityPerSecond;

  // Arrival rate inversely proportional to speed ratio
  const baseArrivalRate = 0.15 + 0.65 * (1 - speedRatio);

  if (serviceRate <= 0) return 60;
  const utilization = baseArrivalRate / serviceRate;
  if (utilization >= 0.99) return 60;

  // Offset models the alignment of green with arrivals
  // Good offset (green starts when queue discharges) → effective arrival rate reduced
  // Bad offset (red when queue arrives) → effective arrival rate increased
  // Compute effective arrival modifier based on offset quality
  // Assume arrivals are uniformly distributed; green covers a fraction of cycle
  const greenStart = ((offsetSeconds % cycleLength) + cycleLength) % cycleLength;
  const greenEnd = (greenStart + greenDuration) % cycleLength;

  // Quality of offset: arrivals that fall within green fraction get through
  // Effective arrival rate = base * (1 - greenFraction * offsetQuality)
  // offsetQuality = how well green aligns with arrival peak (0=worst, 1=best)
  const greenFraction = greenDuration / cycleLength;
  // Arrival phase relative to green: offsetQuality peaks when arrivals fall in green
  // Use sinusoidal model: quality = sin(π * greenFraction) for random offset
  // When arrivals concentrate at a specific phase, quality depends on alignment
  const arrivalPhaseBias = (speedRatio < 0.65) ? Math.PI * 0.7 : Math.PI * 0.3; // heavy=arrivals concentrated
  const offsetPhase = (greenStart / cycleLength) * Math.PI * 2;
  const quality = 0.5 + 0.5 * Math.cos(offsetPhase - arrivalPhaseBias); // 0..1

  const effectiveArrivalRate = baseArrivalRate * (1 - greenFraction * quality * 0.4);
  const effUtilization = effectiveArrivalRate / serviceRate;
  if (effUtilization >= 0.99) return 60;

  // M/G/1 delay
  const c = 0.3;
  const cycleTimeFraction = cycleLength / 60;
  const delay = (effUtilization * (1 + c * c) / (2 * (1 - effUtilization))) * cycleTimeFraction;
  return Math.min(delay, 60);
}

// Compute arrival rate proxy from speed ratio
function arrivalRateFromSpeedRatio(speedRatio, regime) {
  // vehicles per second per lane
  // free: 0.3/s, light: 0.45/s, heavy: 0.6/s, blocked: 0.75/s
  const baseRates = { free: 0.3, light: 0.45, heavy: 0.6, blocked: 0.75 };
  return baseRates[regime] ?? 0.5;
}

// Greedy optimization: try all offsets for each signal, pick best
export function greedyOptimizeSignalOffsets(signals, arrivalModel, slot = "morning-rush") {
  // Build speed ratio map from arrival model
  const speedRatioMap = new Map();
  if (arrivalModel) {
    for (const approach of arrivalModel.approaches) {
      if (approach.timeSlot === slot) {
        const existing = speedRatioMap.get(approach.signalId);
        if (!existing) speedRatioMap.set(approach.signalId, []);
        speedRatioMap.get(approach.signalId).push(approach.speedRatio);
      }
    }
  }

  const results = [];

  for (const signal of signals) {
    const { greenDuration, cycleLength } = getSignalTiming(signal);

    // Get average speed ratio for this signal
    let speedRatio = 0.6; // default
    const ratios = speedRatioMap.get(signal.id);
    if (ratios && ratios.length > 0) {
      speedRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    }

    const regime = classifyRegime(speedRatio);
    const arrivalRate = arrivalRateFromSpeedRatio(speedRatio, regime);

    let bestOffset = signal.offsetSeconds ?? 0;
    let bestDelay = evaluateOffset(speedRatio, greenDuration, cycleLength, bestOffset);

    for (const candidate of OFFSET_CANDIDATES) {
      const delay = evaluateOffset(speedRatio, greenDuration, cycleLength, candidate);
      if (delay < bestDelay) {
        bestDelay = delay;
        bestOffset = candidate;
      }
    }

    const delta = bestOffset - (signal.offsetSeconds ?? 0);

    results.push({
      signalId: signal.id,
      signalName: signal.name,
      position: signal.position,
      currentOffset: signal.offsetSeconds ?? 0,
      bestOffset,
      deltaOffset: delta,
      speedRatio: Math.round(speedRatio * 1000) / 1000,
      regime,
      bestDelaySeconds: Math.round(bestDelay * 10) / 10,
      greenDuration,
      cycleLength,
    });
  }

  return results;
}

// Also compute delay for fixed baseline (no optimization)
export function evaluateBaseline(signals, arrivalModel, slot = "morning-rush") {
  const speedRatioMap = new Map();
  if (arrivalModel) {
    for (const approach of arrivalModel.approaches) {
      if (approach.timeSlot === slot) {
        const existing = speedRatioMap.get(approach.signalId);
        if (!existing) speedRatioMap.set(approach.signalId, []);
        speedRatioMap.get(approach.signalId).push(approach.speedRatio);
      }
    }
  }

  let totalDelay = 0;
  let signalCount = 0;

  for (const signal of signals) {
    const { greenDuration, cycleLength } = getSignalTiming(signal);
    const ratios = speedRatioMap.get(signal.id);
    let speedRatio = ratios && ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0.6;
    const regime = classifyRegime(speedRatio);
    const arrivalRate = arrivalRateFromSpeedRatio(speedRatio, regime);
    const delay = evaluateOffset(speedRatio, greenDuration, cycleLength, signal.offsetSeconds ?? 0);
    totalDelay += delay;
    signalCount++;
  }

  return {
    avgDelaySeconds: signalCount > 0 ? Math.round((totalDelay / signalCount) * 10) / 10 : 0,
    signalCount,
  };
}

export async function main() {
  console.log("Running greedy offset optimizer...");
  console.log(`Signals: ${signalPrograms.length}`);

  const slots = ["morning-rush", "midday", "afternoon-rush"];

  const allResults = {};
  const allBaselines = {};

  for (const slot of slots) {
    console.log(`\nSlot: ${slot}`);
    const results = greedyOptimizeSignalOffsets(signalPrograms, arrivalModel, slot);
    const baseline = evaluateBaseline(signalPrograms, arrivalModel, slot);

    allResults[slot] = results;
    allBaselines[slot] = baseline;

    const improvedSignals = results.filter((r) => r.deltaOffset !== 0).length;
    const avgDelayOptimized = results.reduce((a, b) => a + b.bestDelaySeconds, 0) / results.length;
    const avgDelayBaseline = baseline.avgDelaySeconds;

    console.log(`  Signals: ${results.length}, Improved: ${improvedSignals}`);
    console.log(`  Baseline avg delay: ${avgDelayBaseline}s, Optimized: ${avgDelayOptimized.toFixed(1)}s`);
    console.log(`  Delay reduction: ${((avgDelayBaseline - avgDelayOptimized) / avgDelayBaseline * 100).toFixed(1)}%`);

    const extendCount = results.filter((r) => r.deltaOffset > 0).length;
    const cutCount = results.filter((r) => r.deltaOffset < 0).length;
    console.log(`  Offset changes: +${extendCount} extend, -${cutCount} cut`);
  }

  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync("data/derived", { recursive: true });

  const output = {
    generatedAt: new Date().toISOString(),
    scope: "Greedy signal offset optimization for Timișoara",
    signalsWithData: arrivalModel ? arrivalModel.signalsWithData : 0,
    slots,
    baselines: allBaselines,
    results: allResults,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log(`\n=== Greedy Optimizer Summary ===`);
  for (const slot of slots) {
    const baseline = allBaselines[slot];
    const results = allResults[slot];
    const avgOpt = results.reduce((a, b) => a + b.bestDelaySeconds, 0) / results.length;
    console.log(`${slot}: baseline=${baseline.avgDelaySeconds}s, optimized=${avgOpt.toFixed(1)}s, improvement=${((baseline.avgDelaySeconds - avgOpt) / baseline.avgDelaySeconds * 100).toFixed(1)}%`);
  }

  console.log(`\nOutput: ${OUTPUT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
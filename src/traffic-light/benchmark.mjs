// src/traffic-light/benchmark.mjs
// Benchmark: Compare baseline vs TACTICS vs greedy offset optimization
// across 4 scenarios using predicted delay metrics.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SIGNALS_PATH = "data/traffic-lights/signals.json";
const ARRIVAL_MODEL_PATH = "data/derived/arrival-model.json";
const TACTICS_RESULTS_PATH = "data/derived/tactics-results.json";
const GREEDY_RESULTS_PATH = "data/derived/greedy-optimization.json";
const OUTPUT_PATH = "data/derived/benchmark-results.json";

const scenarios = [
  { id: "TM-01", name: "Bulevardul Republicii", groundTruth: 11.2, slot: "morning-rush" },
  { id: "TM-02", name: "Calea Aradului", groundTruth: 8.7, slot: "morning-rush" },
  { id: "TM-03", name: "Calea Șagului", groundTruth: 13.4, slot: "afternoon-rush" },
  { id: "TM-04", name: "Circumvalațiunii", groundTruth: 9.6, slot: "afternoon-rush" },
];

// Load signals
const signalsData = JSON.parse(readFileSync(SIGNALS_PATH, "utf-8"));
const signalPrograms = signalsData.programs;

let arrivalModel;
try {
  arrivalModel = JSON.parse(readFileSync(ARRIVAL_MODEL_PATH, "utf-8"));
} catch {
  arrivalModel = null;
}

let tacticsResults;
try {
  tacticsResults = JSON.parse(readFileSync(TACTICS_RESULTS_PATH, "utf-8"));
} catch {
  tacticsResults = null;
}

let greedyResults;
try {
  greedyResults = JSON.parse(readFileSync(GREEDY_RESULTS_PATH, "utf-8"));
} catch {
  greedyResults = null;
}

// Build speed ratio map from arrival model
const speedRatioBySignal = new Map();
if (arrivalModel) {
  for (const app of arrivalModel.approaches) {
    const existing = speedRatioBySignal.get(app.signalId);
    if (!existing) speedRatioBySignal.set(app.signalId, []);
    speedRatioBySignal.get(app.signalId).push(app.speedRatio);
  }
}

function avgSpeedRatio(signalId) {
  const ratios = speedRatioBySignal.get(signalId);
  if (!ratios || ratios.length === 0) return 0.6;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

function classifyRegime(speedRatio) {
  if (speedRatio >= 0.85) return "free";
  if (speedRatio >= 0.65) return "light";
  if (speedRatio >= 0.40) return "heavy";
  return "blocked";
}

// M/G/1 delay model
function delayModel(speedRatio, greenDuration, cycleLength, offsetSeconds = 0) {
  const laneCapacityPerSecond = 0.5;
  const serviceRate = (greenDuration / cycleLength) * laneCapacityPerSecond;
  const baseArrivalRate = 0.15 + 0.65 * (1 - speedRatio);

  if (serviceRate <= 0) return 60;
  const utilization = baseArrivalRate / serviceRate;
  if (utilization >= 0.99) return 60;

  // Offset quality effect
  const greenStart = ((offsetSeconds % cycleLength) + cycleLength) % cycleLength;
  const greenFraction = greenDuration / cycleLength;
  const arrivalPhaseBias = (speedRatio < 0.65) ? Math.PI * 0.7 : Math.PI * 0.3;
  const offsetPhase = (greenStart / cycleLength) * Math.PI * 2;
  const quality = 0.5 + 0.5 * Math.cos(offsetPhase - arrivalPhaseBias);
  const effectiveArrivalRate = baseArrivalRate * (1 - greenFraction * quality * 0.4);
  const effUtilization = effectiveArrivalRate / serviceRate;
  if (effUtilization >= 0.99) return 60;

  const c = 0.3;
  const cycleTimeFraction = cycleLength / 60;
  return Math.min((effUtilization * (1 + c * c) / (2 * (1 - effUtilization))) * cycleTimeFraction, 60);
}

// Get green duration for a signal
function getGreenDuration(program) {
  return program.phases.filter((p) => p.state === "green").reduce((a, p) => a + p.durationSeconds, 0);
}

function getCycleLength(program) {
  return program.phases.reduce((a, p) => a + p.durationSeconds, 0);
}

// --- Compute city-wide delay for each strategy ---

function computeBaselineDelay(signals, slot) {
  let total = 0, n = 0;
  for (const s of signals) {
    const sr = avgSpeedRatio(s.id);
    const gd = getGreenDuration(s);
    const cl = getCycleLength(s);
    const d = delayModel(sr, gd, cl, s.offsetSeconds ?? 0);
    total += d;
    n++;
  }
  return n > 0 ? total / n : 0;
}

function computeTacticsDelay(signals, slot) {
  if (!tacticsResults) return computeBaselineDelay(signals, slot);
  const tacticsBySignalHour = new Map();
  for (const r of tacticsResults.evaluations) {
    const key = `${r.signalId}__${r.hour}`;
    tacticsBySignalHour.set(key, r);
  }

  // Map slot to hour
  const slotHourMap = { "morning-rush": 7, "midday": 12, "afternoon-rush": 15, "evening": 18 };
  const hour = slotHourMap[slot] ?? 9;

  let total = 0, n = 0;
  for (const s of signals) {
    const key = `${s.id}__${hour}`;
    const tacticsEval = tacticsBySignalHour.get(key);
    const sr = avgSpeedRatio(s.id);
    const gd = getGreenDuration(s);
    const cl = getCycleLength(s);

    // TACTICS modifies green duration
    let adaptedGd = gd;
    if (tacticsEval) {
      const delta = tacticsEval.deltaGreenSeconds;
      adaptedGd = Math.max(10, gd + delta);
    }

    const d = delayModel(sr, adaptedGd, cl, s.offsetSeconds ?? 0);
    total += d;
    n++;
  }
  return n > 0 ? total / n : 0;
}

function computeGreedyDelay(signals, slot) {
  if (!greedyResults || !greedyResults.results[slot]) return computeBaselineDelay(signals, slot);
  const greedyBySignal = new Map();
  for (const r of greedyResults.results[slot]) {
    greedyBySignal.set(r.signalId, r);
  }

  let total = 0, n = 0;
  for (const s of signals) {
    const optResult = greedyBySignal.get(s.id);
    const sr = avgSpeedRatio(s.id);
    const gd = getGreenDuration(s);
    const cl = getCycleLength(s);
    const bestOffset = optResult ? optResult.bestOffset : (s.offsetSeconds ?? 0);
    const d = delayModel(sr, gd, cl, bestOffset);
    total += d;
    n++;
  }
  return n > 0 ? total / n : 0;
}

// --- Per-scenario results ---

const results = [];

for (const scenario of scenarios) {
  console.log(`\n=== ${scenario.id}: ${scenario.name} ===`);
  console.log(`Ground truth: ${scenario.groundTruth}s delay reduction`);
  console.log(`Slot: ${scenario.slot}`);

  const baseline = computeBaselineDelay(signalPrograms, scenario.slot);
  const tactics = computeTacticsDelay(signalPrograms, scenario.slot);
  const greedy = computeGreedyDelay(signalPrograms, scenario.slot);

  // How well does each approach reduce delay?
  const tacticsImprovement = baseline - tactics;
  const greedyImprovement = baseline - greedy;

  // Compare to ground truth (expected delay reduction)
  // Note: ground truth is absolute delay reduction, not percentage
  const tacticsVsTruth = Math.abs(tacticsImprovement - scenario.groundTruth);
  const greedyVsTruth = Math.abs(greedyImprovement - scenario.groundTruth);
  const baselineVsTruth = Math.abs(baseline - scenario.groundTruth);

  console.log(`Baseline avg delay: ${baseline.toFixed(1)}s`);
  console.log(`TACTICS avg delay: ${tactics.toFixed(1)}s (improvement: ${tacticsImprovement.toFixed(1)}s)`);
  console.log(`Greedy avg delay: ${greedy.toFixed(1)}s (improvement: ${greedyImprovement.toFixed(1)}s)`);
  console.log(`\nClosest to ground truth: baseline=${baselineVsTruth.toFixed(1)}, tactics=${tacticsVsTruth.toFixed(1)}, greedy=${greedyVsTruth.toFixed(1)}`);

  results.push({
    scenarioId: scenario.id,
    corridor: scenario.name,
    groundTruthSeconds: scenario.groundTruth,
    slot: scenario.slot,
    baselineDelaySeconds: Math.round(baseline * 10) / 10,
    tacticsDelaySeconds: Math.round(tactics * 10) / 10,
    greedyDelaySeconds: Math.round(greedy * 10) / 10,
    tacticsImprovementSeconds: Math.round(tacticsImprovement * 10) / 10,
    greedyImprovementSeconds: Math.round(greedyImprovement * 10) / 10,
    accuracyVsGroundTruth: {
      baseline: Math.round(baselineVsTruth * 10) / 10,
      tactics: Math.round(tacticsVsTruth * 10) / 10,
      greedy: Math.round(greedyVsTruth * 10) / 10,
    },
    winningStrategy: tacticsVsTruth <= greedyVsTruth
      ? (tacticsVsTruth <= baselineVsTruth ? "TACTICS" : "baseline")
      : (greedyVsTruth <= baselineVsTruth ? "greedy" : "baseline"),
  });
}

// Summary
console.log("\n=== BENCHMARK SUMMARY ===");
console.log("Scenario | Ground Truth | Baseline | TACTICS | Greedy | Best");
console.log("---------|-------------|----------|---------|--------|-----");
let tacticsWins = 0, greedyWins = 0, baselineWins = 0;
for (const r of results) {
  console.log(`${r.scenarioId} | ${r.groundTruthSeconds}s | ${r.baselineDelaySeconds}s | ${r.tacticsDelaySeconds}s | ${r.greedyDelaySeconds}s | ${r.winningStrategy}`);
  if (r.winningStrategy === "TACTICS") tacticsWins++;
  else if (r.winningStrategy === "greedy") greedyWins++;
  else baselineWins++;
}
console.log(`\nWins: TACTICS=${tacticsWins}, Greedy=${greedyWins}, Baseline=${baselineWins}`);

// City-wide stats
const cityBaseline = computeBaselineDelay(signalPrograms, "morning-rush");
const cityTactics = computeTacticsDelay(signalPrograms, "morning-rush");
const cityGreedy = computeGreedyDelay(signalPrograms, "morning-rush");
console.log(`\nCity-wide (morning-rush): baseline=${cityBaseline.toFixed(1)}s, TACTICS=${cityTactics.toFixed(1)}s (${(cityBaseline-cityTactics).toFixed(1)}s saved), greedy=${cityGreedy.toFixed(1)}s (${(cityBaseline-cityGreedy).toFixed(1)}s saved)`);

const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync("data/derived", { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify({
  generatedAt: new Date().toISOString(),
  scope: "Benchmark: baseline vs TACTICS vs greedy signal offset",
  scenarios: results,
  summary: { tacticsWins, greedyWins, baselineWins },
  cityWide: {
    morningRush: {
      baseline: Math.round(cityBaseline * 10) / 10,
      tactics: Math.round(cityTactics * 10) / 10,
      greedy: Math.round(cityGreedy * 10) / 10,
      tacticsSaving: Math.round((cityBaseline - cityTactics) * 10) / 10,
      greedySaving: Math.round((cityBaseline - cityGreedy) * 10) / 10,
    }
  }
}, null, 2));
console.log(`\nOutput: ${OUTPUT_PATH}`);
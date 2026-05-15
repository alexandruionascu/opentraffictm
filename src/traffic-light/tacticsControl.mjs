// src/traffic-light/tacticsControl.mjs
// TACTICS fuzzy reactive traffic signal control (Cosariu et al. 2015)
// Adapts green time per intersection based on queue length, arrival rate, and time of day.
// No actual hardware needed — uses probe-derived arrival models as input.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SIGNALS_PATH = "data/traffic-lights/signals.json";
const ARRIVAL_MODEL_PATH = "data/derived/arrival-model.json";

export const TIME_SLOTS = ["night", "morning-rush", "mid-morning", "midday", "afternoon-rush", "evening", "late-night"];
export const REGIME_THRESHOLDS = { free: 0.85, light: 0.65, heavy: 0.40 };

export function classifySlot(hour) {
  if (hour >= 0 && hour < 6) return "night";
  if (hour >= 6 && hour < 8) return "morning-rush";
  if (hour >= 8 && hour < 10) return "mid-morning";
  if (hour >= 10 && hour < 14) return "midday";
  if (hour >= 14 && hour < 17) return "afternoon-rush";
  if (hour >= 17 && hour < 21) return "evening";
  return "late-night";
}

export function classifyRegime(speedRatio) {
  if (speedRatio >= REGIME_THRESHOLDS.free) return "free";
  if (speedRatio >= REGIME_THRESHOLDS.light) return "light";
  if (speedRatio >= REGIME_THRESHOLDS.heavy) return "heavy";
  return "blocked";
}

// --- Fuzzy membership functions ---

function fuzzySpeedRatio(v) {
  // v: 0..1 (speed ratio)
  return {
    blocked: clamp((0.40 - v) / 0.40, 0, 1),
    heavy: clamp((v - 0.40) / 0.25, 0, 1) * clamp((0.65 - v) / 0.25, 0, 1) + clamp((v < 0.40) ? 0 : (v - 0.40) / 0.25, 0, 1) * clamp((v >= 0.65) ? 0 : (0.65 - v) / 0.25, 0, 1),
    light: clamp((v - 0.65) / 0.20, 0, 1) * clamp((0.85 - v) / 0.20, 0, 1),
    free: clamp((v - 0.85) / 0.15, 0, 1),
  };
}

function fuzzyQueueLength(q) {
  // q: 0..1 (normalized queue: 0=free, 1=saturated)
  return {
    short: clamp(1 - q * 2, 0, 1),
    medium: clamp((q - 0.25) * 4, 0, 1) * clamp((0.75 - q) * 4, 0, 1) + (q <= 0.25 ? clamp(q * 4, 0, 1) : 0),
    long: clamp((q - 0.5) * 2, 0, 1),
    saturated: clamp((q - 0.75) * 4, 0, 1),
  };
}

function fuzzyTimeOfDay(hour) {
  // hour: 0..23
  return {
    night: (hour < 6) ? 1 : 0,
    morning: (hour >= 6 && hour < 10) ? 1 : 0,
    midday: (hour >= 10 && hour < 14) ? 1 : 0,
    afternoon: (hour >= 14 && hour < 19) ? 1 : 0,
    evening: (hour >= 19 && hour < 22) ? 1 : 0,
    late: (hour >= 22 || hour < 6) ? 1 : 0,
  };
}

// --- Fuzzy inference rules ---
// Returns a crisp delta-green-time adjustment in seconds: negative=early cut, positive=green extension
// Rule base derived from TACTICS methodology (Cosariu et al. 2015)
// Conditions: IF queue IS {short|medium|long|saturated} AND speed_ratio IS {blocked|heavy|light|free} AND time IS {morning|midday|afternoon|evening}
// Actions: adjust green time by ±1..10s

const RULES = [
  // Saturated + blocked → strong extension
  { queue: "saturated", speed: "blocked", weight: 2.5, bias: 8 },
  // Saturated + heavy → moderate extension
  { queue: "saturated", speed: "heavy", weight: 2.0, bias: 5 },
  // Long + blocked → moderate extension
  { queue: "long", speed: "blocked", weight: 1.5, bias: 4 },
  // Long + heavy → slight extension
  { queue: "long", speed: "heavy", weight: 1.0, bias: 2 },
  // Long + light → slight cut (unbalanced)
  { queue: "long", speed: "light", weight: -0.8, bias: -1 },
  // Medium + blocked → slight extension
  { queue: "medium", speed: "blocked", weight: 1.0, bias: 2 },
  // Medium + free → cut (excess capacity)
  { queue: "medium", speed: "free", weight: -1.2, bias: -3 },
  // Short + free → cut (very low demand)
  { queue: "short", speed: "free", weight: -2.0, bias: -5 },
  // Short + light → slight cut
  { queue: "short", speed: "light", weight: -1.0, bias: -2 },
  // Short + blocked → no change (rare)
  { queue: "short", speed: "blocked", weight: 0.5, bias: 1 },
  // Saturated + light → slight extension
  { queue: "saturated", speed: "light", weight: 0.8, bias: 2 },
  // Saturated + free → slight extension
  { queue: "saturated", speed: "free", weight: 0.5, bias: 1 },
  // Medium + heavy → very slight extension
  { queue: "medium", speed: "heavy", weight: 0.6, bias: 1 },
  // Medium + light → no change
  { queue: "medium", speed: "light", weight: 0.3, bias: 0 },
  // Long + free → cut
  { queue: "long", speed: "free", weight: -1.5, bias: -3 },
  // Long + light → slight cut (already covered but for completeness)
  { queue: "long", speed: "light", weight: -0.8, bias: -1 },
];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function fuzzyAnd(a, b) {
  return Math.min(a, b);
}

function fuzzyOr(a, b) {
  return Math.max(a, b);
}

export function computeTacticsAdjustment(speedRatio, queueFraction, hour) {
  // speedRatio: 0..1 (current speed / free-flow speed)
  // queueFraction: 0..1 (0=free, 1=saturated)
  // hour: 0..23

  const speedMemberships = fuzzySpeedRatio(speedRatio);
  const queueMemberships = fuzzyQueueLength(queueFraction);
  const timeMemberships = fuzzyTimeOfDay(hour);

  // Aggregate rule outputs using weighted Mamdani-style inference
  let totalWeight = 0;
  let weightedSum = 0;

  for (const rule of RULES) {
    const qMu = queueMemberships[rule.queue] ?? 0;
    const sMu = speedMemberships[rule.speed] ?? 0;
    const tMu = Object.values(timeMemberships).reduce((a, b) => fuzzyOr(a, b), 0);

    // Time-of-day multiplier: higher during peak hours
    const timeMultiplier = (timeMemberships.morning || timeMemberships.afternoon) ? 1.3
      : timeMemberships.midday ? 1.1
      : timeMemberships.evening ? 0.9 : 0.7;

    const activation = fuzzyAnd(fuzzyAnd(qMu, sMu), tMu);
    if (activation > 0.01) {
      const delta = (rule.weight * speedRatio + rule.bias) * timeMultiplier;
      weightedSum += activation * delta;
      totalWeight += activation;
    }
  }

  if (totalWeight < 0.01) return 0;
  return clamp(weightedSum / totalWeight, -10, 10);
}

export function estimateQueueFraction(speedRatio, regime) {
  // Convert speed ratio to queue fraction estimate (inverse relationship)
  // free (0.85+) → 0.0-0.15
  // light (0.65-0.85) → 0.15-0.40
  // heavy (0.40-0.65) → 0.40-0.70
  // blocked (<0.40) → 0.70-1.0
  if (regime === "free") return clamp(1 - (speedRatio - 0.85) / 0.15 * 0.15, 0, 0.15);
  if (regime === "light") return clamp(0.15 + (0.85 - speedRatio) / 0.20 * 0.25, 0.15, 0.40);
  if (regime === "heavy") return clamp(0.40 + (0.65 - speedRatio) / 0.25 * 0.30, 0.40, 0.70);
  return clamp(0.70 + (0.40 - speedRatio) / 0.40 * 0.30, 0.70, 1.0);
}

// --- Signal program update ---
export function adaptSignalProgram(program, speedRatio, hour) {
  // program: { id, phases, offsetSeconds }
  // Returns new phases with adapted green times
  const regime = classifyRegime(speedRatio);
  const queueFraction = estimateQueueFraction(speedRatio, regime);
  const deltaGreen = computeTacticsAdjustment(speedRatio, queueFraction, hour);

  const adaptedPhases = program.phases.map((phase, i) => {
    if (phase.state !== "green") return phase;
    const newDuration = Math.max(10, phase.durationSeconds + Math.round(deltaGreen));
    return { ...phase, durationSeconds: newDuration };
  });

  return {
    ...program,
    phases: adaptedPhases,
    tacticsDeltaGreen: Math.round(deltaGreen * 10) / 10,
    tacticsRegime: regime,
    tacticsQueueFraction: Math.round(queueFraction * 100) / 100,
  };
}

// --- Message types (from TACTICS paper) ---
export const MessageType = {
  REQ_INC_LOW: "REQ_INC_LOW",
  REQ_INC_HIGH: "REQ_INC_HIGH",
  REQ_DEC_LOW: "REQ_DEC_LOW",
  REQ_DEC_HIGH: "REQ_DEC_HIGH",
  REP_YES: "REP_YES",
  REP_NO: "REP_NO",
};

export function createTacticsMessage(type, sourceId, targetId, payload = {}) {
  return {
    messageId: `${type}_${sourceId}_${Date.now()}`,
    messageType: type,
    source: sourceId,
    target: targetId,
    payload,
    timestamp: Date.now(),
  };
}

export function interpretMessage(message, localConditions) {
  // Returns { accept: boolean, adjustGreen: number }
  // Simulates slave intersection response
  const { messageType, payload } = message;
  const { localQueue, localSpeedRatio, maxGreenExtension } = localConditions;

  if (messageType === MessageType.REQ_INC_LOW || messageType === MessageType.REQ_INC_HIGH) {
    const incAmount = messageType === MessageType.REQ_INC_HIGH ? 5 : 2;
    // Accept if local queue is not saturated
    if (localQueue < 0.7) {
      return { accept: true, adjustGreen: incAmount };
    }
    return { accept: false, adjustGreen: 0 };
  }

  if (messageType === MessageType.REQ_DEC_LOW || messageType === MessageType.REQ_DEC_HIGH) {
    const decAmount = messageType === MessageType.REQ_DEC_HIGH ? 5 : 2;
    // Accept if local speed ratio is high (excess capacity)
    if (localSpeedRatio > 0.8) {
      return { accept: true, adjustGreen: -decAmount };
    }
    return { accept: false, adjustGreen: 0 };
  }

  return { accept: false, adjustGreen: 0 };
}

// --- Per-signal TACTICS evaluation ---
export function evaluateSignalWithTactics(signalId, speedRatio, hour, cycleLengthSeconds) {
  const regime = classifyRegime(speedRatio);
  const queueFraction = estimateQueueFraction(speedRatio, regime);
  const deltaGreen = computeTacticsAdjustment(speedRatio, queueFraction, hour);
  const absDelta = Math.abs(deltaGreen);

  let action = "hold";
  if (deltaGreen > 2) action = "extend";
  else if (deltaGreen < -2) action = "cut";

  // Confidence based on agreement between rules
  const confidence = clamp(absDelta / 5, 0.2, 1.0);

  // Message decisions
  let outgoingMessages = [];
  if (absDelta > 3) {
    const msgType = deltaGreen > 0
      ? (absDelta > 6 ? MessageType.REQ_INC_HIGH : MessageType.REQ_INC_LOW)
      : (absDelta > 6 ? MessageType.REQ_DEC_HIGH : MessageType.REQ_DEC_LOW);
    outgoingMessages.push({ type: msgType, deltaGreenSeconds: Math.round(deltaGreen) });
  }

  return {
    signalId,
    speedRatio: Math.round(speedRatio * 1000) / 1000,
    regime,
    queueFraction: Math.round(queueFraction * 100) / 100,
    deltaGreenSeconds: Math.round(deltaGreen * 10) / 10,
    action,
    confidence: Math.round(confidence * 100) / 100,
    outgoingMessages,
    cycleLengthSeconds,
  };
}

// --- Batch evaluation for all signals ---
export async function runTacticsOnSignals(signalsPath = SIGNALS_PATH, arrivalModelPath = ARRIVAL_MODEL_PATH) {
  const signalsData = JSON.parse(readFileSync(signalsPath, "utf-8"));
  let arrivalModel;
  try {
    arrivalModel = JSON.parse(readFileSync(arrivalModelPath, "utf-8"));
  } catch {
    arrivalModel = null;
  }

  const results = [];
  for (const signal of signalsData.programs) {
    // Find speed ratio for this signal from arrival model
    let speedRatio = 0.6; // default
    if (arrivalModel) {
      const approaches = arrivalModel.approaches.filter((a) => a.signalId === signal.id);
      if (approaches.length > 0) {
        speedRatio = approaches.reduce((a, b) => a + b.speedRatio, 0) / approaches.length;
      }
    }

    const cycleLength = signal.phases.reduce((s, p) => s + p.durationSeconds, 0);

    for (const hour of [7, 9, 12, 15, 18, 21]) {
      const result = evaluateSignalWithTactics(signal.id, speedRatio, hour, cycleLength);
      results.push({
        signalId: signal.id,
        signalName: signal.name,
        position: signal.position,
        hour,
        ...result,
      });
    }
  }

  return results;
}

// Run as script
const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync("data/derived", { recursive: true });

console.log("Running TACTICS adaptive control evaluation...");
const results = await runTacticsOnSignals();

writeFileSync("data/derived/tactics-results.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  scope: "TACTICS fuzzy reactive control evaluation for Timișoara signals",
  totalSignals: results.length / 6,
  evaluations: results,
}, null, 2));

const extendCount = results.filter((r) => r.action === "extend").length;
const cutCount = results.filter((r) => r.action === "cut").length;
const holdCount = results.filter((r) => r.action === "hold").length;

console.log(`\n=== TACTICS Results ===`);
console.log(`Signals evaluated: ${results.length / 6}`);
console.log(`Actions: extend=${extendCount}, cut=${cutCount}, hold=${holdCount}`);

const byHour = {};
for (const r of results) {
  if (!byHour[r.hour]) byHour[r.hour] = { extend: 0, cut: 0, hold: 0, total: 0 };
  byHour[r.hour][r.action]++;
  byHour[r.hour].total++;
}
console.log(`\nBy hour:`);
for (const [hour, stats] of Object.entries(byHour)) {
  console.log(`  ${hour}:00 — extend=${stats.extend}, cut=${stats.cut}, hold=${stats.hold} (${stats.total} signals)`);
}

const byRegime = {};
for (const r of results) {
  if (!byRegime[r.regime]) byRegime[r.regime] = { extend: 0, cut: 0, hold: 0, total: 0 };
  byRegime[r.regime][r.action]++;
  byRegime[r.regime].total++;
}
console.log(`\nBy regime:`);
for (const [regime, stats] of Object.entries(byRegime)) {
  console.log(`  ${regime}: extend=${stats.extend}, cut=${stats.cut}, hold=${stats.hold} (${stats.total} evaluations)`);
}

console.log(`\nOutput: data/derived/tactics-results.json`);
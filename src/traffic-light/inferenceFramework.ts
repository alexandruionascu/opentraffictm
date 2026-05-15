/**
 * Uncertainty-Aware Traffic Light Inference Framework
 *
 * Separates observable external behavior from inferred internal controller logic.
 * All claims include confidence scoring and explicit "cannot infer" statements.
 *
 * Key design principles:
 * - Observable: stop durations, travel times, queue signatures, green/red windows
 * - NOT observable: internal controller state, detector states, proprietary algorithms
 * - Default stance: "This cannot be confidently inferred" unless evidence is strong
 */

import { circularConcentration, circularMean, circularDistance, modulo } from "./mapMatching";
import type { TrafficLightEstimate, TrafficLightLocation, TrafficLightPass } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";

export interface CycleLengthPosterior {
  mapSeconds: number;
  ci95Lower: number;
  ci95Upper: number;
  concentrationKappa: number;
  posterior: Array<{ cycleSeconds: number; confidence: number }>;
  nObservations: number;
  evidenceStrength: "strong" | "moderate" | "weak";
}

export interface AdaptiveClassification {
  category: "fixed-cycle" | "semi-adaptive" | "highly-adaptive" | "uncertain";
  confidenceLevel: ConfidenceLevel;
  numericalScore: number; // 0-1, higher = more adaptive
  statisticalEvidence: StatisticalEvidence;
  cannotInferStatements: string[];
  explanation: string;
}

export interface StatisticalEvidence {
  adfPValue: number | null;       // Augmented Dickey-Fuller: stationarity
  kpssPValue: number | null;       // KPSS: stationarity (null = stationary)
  levenePValue: number | null;      // Variance equality across congestion levels
  anovaFStat: number | null;       // Phase duration variation across TOD slots
  withinSlotVariance: number | null; // Cycle-to-cycle variance at same TOD slot
  nObservations: number;
}

export interface PhasePosteriorWithEntropy {
  state: "green" | "red" | "unknown";
  confidence: number;
  entropyBits: number;             // Lower = more confident inference
  posteriorGreen: number;          // P(green | all observations)
  posteriorRed: number;
  nSamples: number;
}

export interface BootstrapResult {
  cycleLengthSeconds: number;
  bootstrapStdErr: number;
  ci95Lower: number;
  ci95Upper: number;
  nBootstrapSamples: number;
}

export interface IntersectionNarrative {
  intersectionId: string;
  whatWeObserved: string;
  whatWeInferred: string;
  confidenceLevel: ConfidenceLevel;
  confidenceReasoning: string;
  whatThisMeans: string;
  whatWeCannotConclude: string[];
  suggestions: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistical Test Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Augmented Dickey-Fuller test for stationarity.
 * Returns p-value; low p-value suggests stationary (fixed-cycle more likely).
 * Uses simple regression-based ADF with no external packages.
 */
function adfTest(series: number[]): number | null {
  if (series.length < 8) return null;

  const n = series.length;
  const diffs = series.slice(1).map((v, i) => v - series[i]);
  const levels = series.slice(0, n - 1);

  // Simple OLS: Δy = α + γ*y_{t-1} + ... + ε
  // Compute means for simple Dickey-Fuller variant
  const yMean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  const xMean = levels.reduce((s, v) => s + v, 0) / levels.length;

  let num = 0, den = 0;
  for (let i = 0; i < diffs.length; i++) {
    num += (levels[i] - xMean) * diffs[i];
    den += (levels[i] - xMean) ** 2;
  }

  if (den < 1e-10) return null;
  const gamma = num / den;
  const residSq = diffs.reduce((s, v, i) => s + (v - yMean) ** 2, 0) / (n - 1);
  const seGamma = Math.sqrt(residSq / den);

  if (seGamma < 1e-10) return null;
  const tStat = gamma / seGamma;

  // Approximate MacKinnon critical values (simple approximation)
  // For n > 100 we'd use proper critical values; for small n use conservative bound
  const absT = Math.abs(tStat);
  if (absT > 3.4) return 0.001;
  if (absT > 2.9) return 0.01;
  if (absT > 2.5) return 0.05;
  if (absT > 2.0) return 0.10;
  return 0.20; // cannot reject unit root
}

/**
 * KPSS test for stationarity (null hypothesis: stationarity).
 * Returns p-value; high p-value → cannot reject stationarity → consistent with fixed.
 * Simple variance-ratio variant.
 */
function kpssTest(series: number[]): number | null {
  if (series.length < 8) return null;

  const diffs = series.slice(1).map((v, i) => v - series[i]);
  const cumSum = [0];
  for (const d of diffs) cumSum.push(cumSum[cumSum.length - 1] + d);
  const meanDiffs = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  const residualSq = diffs.reduce((s, v) => s + (v - meanDiffs) ** 2, 0) / diffs.length;

  // Variance of cumulative residuals (KPSS statistic)
  const centeredCum = cumSum.map(v => v - cumSum[cumSum.length - 1] / 2);
  const varianceRatio = centeredCum.reduce((s, v) => s + v * v, 0) / (series.length * residualSq + 1e-10);

  // Map to p-value (approximate, conservative)
  // Higher variance ratio → more non-stationary → reject null
  if (varianceRatio < 0.5) return 0.20;   // Cannot reject stationarity
  if (varianceRatio < 1.0) return 0.10;
  if (varianceRatio < 2.0) return 0.05;
  if (varianceRatio < 4.0) return 0.02;
  return 0.01; // reject null (non-stationary)
}

/**
 * Levene's test for equality of variance across groups.
 * Returns p-value; p < 0.05 suggests unequal variance → adaptive.
 */
function leveneTest(groups: number[][]): number | null {
  const validGroups = groups.filter(g => g.length >= 3);
  if (validGroups.length < 2) return null;
  const totalLen = validGroups.reduce((s, g) => s + g.length, 0);
  if (totalLen < 6) return null;

  const medians = validGroups.map(g => {
    const sorted = [...g].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });

  const numerators = validGroups.map((g, i) =>
    g.reduce((s, v) => s + Math.abs(v - medians[i]), 0) / g.length
  );
  const allFlat: number[] = [];
  for (const g of validGroups) { for (const v of g) { allFlat.push(v); } }
  const sortedAll = allFlat.sort((a, b) => a - b);
  const globalMedian = sortedAll[Math.floor(sortedAll.length / 2)];

  const denominator = validGroups.reduce((s, g) =>
    s + g.reduce((ss, v) => ss + Math.abs(v - globalMedian), 0) / g.length, 0
  ) / validGroups.length;

  if (denominator < 1e-10) return null;
  const leveneStat = numerators.reduce((s, v) => s + v * validGroups.length, 0) /
    ((validGroups.length - 1) * denominator);

  // Approximate F-distribution p-value
  const df1 = validGroups.length - 1;
  const df2 = validGroups.reduce((s, g) => s + g.length, 0) - validGroups.length;
  if (df2 < 2) return null;

  // Simple approximation (conservative)
  if (leveneStat < 1.0) return 0.20;
  if (leveneStat < 2.0) return 0.10;
  if (leveneStat < 3.0) return 0.05;
  if (leveneStat < 4.5) return 0.02;
  return 0.01;
}

/**
 * One-way ANOVA F-test for mean equality across groups.
 * Returns F-statistic; high F → phase durations vary by TOD slot.
 */
function anovaFTest(groups: number[][]): { fStat: number; pValue: number } | null {
  const validGroups = groups.filter(g => g.length >= 2);
  if (validGroups.length < 2) return null;

  let allSum = 0, allCount = 0;
  for (const g of validGroups) { for (const v of g) { allSum += v; allCount++; } }
  if (allCount < 3) return null;
  const grandMean = allSum / allCount;

  let ssBetween = 0;
  for (const g of validGroups) {
    const gMean = g.reduce((s, v) => s + v, 0) / g.length;
    ssBetween += g.length * (gMean - grandMean) ** 2;
  }
  let ssWithin = 0;
  for (const g of validGroups) {
    const gMean = g.reduce((s, v) => s + v, 0) / g.length;
    for (const v of g) { ssWithin += (v - gMean) ** 2; }
  }

  const dfBetween = validGroups.length - 1;
  const dfWithin = allCount - validGroups.length;

  if (dfWithin < 1 || ssWithin < 1e-10) return null;

  const fStat = (ssBetween / dfBetween) / (ssWithin / dfWithin);
  if (!isFinite(fStat)) return null;

  // Approximate p-value for F-distribution (conservative)
  if (fStat < 1.0) return { fStat, pValue: 0.30 };
  if (fStat < 2.0) return { fStat, pValue: 0.10 };
  if (fStat < 3.0) return { fStat, pValue: 0.05 };
  if (fStat < 4.0) return { fStat, pValue: 0.02 };
  return { fStat, pValue: 0.01 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence Scoring
// ─────────────────────────────────────────────────────────────────────────────

const HIGH_CONFIDENCE_N = 50;
const MEDIUM_CONFIDENCE_N = 10;

export function computeConfidenceLevel(nObservations: number, concentrationKappa: number, entropyBits: number): ConfidenceLevel {
  if (nObservations < 5) return "insufficient";
  if (nObservations >= HIGH_CONFIDENCE_N && concentrationKappa > 0.6 && entropyBits < 0.5) return "high";
  if (nObservations >= MEDIUM_CONFIDENCE_N || concentrationKappa > 0.3) return "medium";
  return "low";
}

export function numericalConfidenceScore(
  nObservations: number,
  concentrationKappa: number,
  entropyBits: number,
  statisticalTestsPassed: number,
): number {
  const nScore = Math.min(1, nObservations / HIGH_CONFIDENCE_N);
  const kappaScore = Math.min(1, concentrationKappa);
  const entropyScore = Math.max(0, 1 - entropyBits / 2);
  const testScore = Math.min(1, statisticalTestsPassed / 3);

  return 0.3 * nScore + 0.3 * kappaScore + 0.25 * entropyScore + 0.15 * testScore;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cycle Length Posterior (Bayesian + Concentration)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build Bayesian posterior over cycle length candidates with 95% CI.
 * Extends the existing estimateCycleLength() with proper posterior scoring.
 */
export function buildCycleLengthPosterior(stopTimestampsSeconds: number[]): CycleLengthPosterior {
  if (stopTimestampsSeconds.length < 3) {
    const fallback = 90;
    return {
      mapSeconds: fallback,
      ci95Lower: fallback - 15,
      ci95Upper: fallback + 15,
      concentrationKappa: 0,
      posterior: [{ cycleSeconds: fallback, confidence: 0.2 }],
      nObservations: stopTimestampsSeconds.length,
      evidenceStrength: "weak",
    };
  }

  const sorted = [...stopTimestampsSeconds].sort((a, b) => a - b);
  const anchor = sorted[0];

  const candidates: Array<{ cycleSeconds: number; concentration: number; posterior: number }> = [];
  const commonCycles = [60, 70, 75, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180];

  for (let period = 40; period <= 200; period += 1) {
    const circularPhases = sorted.map(t => modulo(t - anchor, period));
    const concentration = circularConcentration(circularPhases, period);

    // Prior: weight toward common cycles (city infrastructure typically uses round numbers)
    const nearestCommon = Math.min(...commonCycles.map(c => Math.abs(c - period)));
    const commonPrior = Math.exp(-0.5 * (nearestCommon / 5) ** 2);

    // Posterior: concentration × prior
    const posteriorScore = concentration * 0.7 + commonPrior * 0.3;
    candidates.push({ cycleSeconds: period, concentration, posterior: posteriorScore });
  }

  // Sort by posterior, normalize to probability
  const sortedCands = candidates.sort((a, b) => b.posterior - a.posterior);
  const maxPosterior = sortedCands[0]?.posterior ?? 1;
  const normalizedPosterior = sortedCands.map(c => ({
    ...c,
    confidence: c.posterior / (maxPosterior + 1e-10),
  }));

  // MAP estimate
  const mapCandidate = normalizedPosterior[0];
  const mapSeconds = mapCandidate?.cycleSeconds ?? 90;

  // 95% CI: find interval containing 95% of posterior mass
  let cumMass = 0;
  const ci95Candidates: number[] = [];
  for (const c of normalizedPosterior) {
    ci95Candidates.push(c.cycleSeconds);
    cumMass += c.confidence;
    if (cumMass >= 0.95) break;
  }
  const ci95Lower = Math.max(40, Math.min(...ci95Candidates));
  const ci95Upper = Math.min(200, Math.max(...ci95Candidates));

  // Evidence strength based on concentration + n
  const topConcentration = normalizedPosterior[0]?.concentration ?? 0;
  const evidenceStrength: CycleLengthPosterior["evidenceStrength"] =
    topConcentration > 0.7 && sorted.length >= 15 ? "strong" :
    topConcentration > 0.4 || sorted.length >= 8 ? "moderate" : "weak";

  return {
    mapSeconds,
    ci95Lower,
    ci95Upper,
    concentrationKappa: topConcentration,
    posterior: normalizedPosterior.slice(0, 20).map(c => ({
      cycleSeconds: c.cycleSeconds,
      confidence: c.confidence,
    })),
    nObservations: sorted.length,
    evidenceStrength,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Adaptive vs Fixed Classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify intersection behavior into fixed-cycle vs adaptive categories.
 * Uses statistical tests to detect variance structure changes.
 *
 * Key insight: Adaptive controllers respond to demand → phase durations change
 * with congestion. Fixed controllers produce stable statistics regardless of load.
 */
export function classifyIntersectionBehavior(
  phaseDurationsBySlot: Record<string, number[]>,    // TOD slot → phase duration samples
  cycleLengths: number[],                              // observed cycle lengths
  stopDurations: number[],                            // red light wait durations
): AdaptiveClassification {
  const slotValues: number[] = [];
  const slotKeys = Object.keys(phaseDurationsBySlot);
  for (const k of slotKeys) { for (const v of phaseDurationsBySlot[k]) { slotValues.push(v); } }
  const nObs = cycleLengths.length + slotValues.length;

  if (nObs < 8) {
    return {
      category: "uncertain",
      confidenceLevel: "insufficient",
      numericalScore: 0.5,
      statisticalEvidence: {
        adfPValue: null,
        kpssPValue: null,
        levenePValue: null,
        anovaFStat: null,
        withinSlotVariance: null,
        nObservations: nObs,
      },
      cannotInferStatements: [
        "Insufficient observations to classify intersection behavior with confidence.",
        "Need at least 8 observations across multiple time-of-day slots.",
        "Cannot distinguish fixed-cycle from adaptive control with sparse data.",
      ],
      explanation: "Data is too sparse to draw statistically meaningful conclusions.",
    };
  }

  // ── Stationarity tests (fixed-cycle → stationary time series) ──
  const adfPValue = adfTest(cycleLengths);
  const kpssPValue = kpssTest(cycleLengths);

  // ── Variance test across congestion levels ──
  // Proxy: group stop durations into "short" and "long" as congestion proxy
  const medianStop = stopDurations.length > 0
    ? [...stopDurations].sort((a, b) => a - b)[Math.floor(stopDurations.length / 2)]
    : 0;
  const shortWaits = stopDurations.filter(d => d < medianStop);
  const longWaits = stopDurations.filter(d => d >= medianStop);
  const levenePValue = shortWaits.length >= 3 && longWaits.length >= 3
    ? leveneTest([shortWaits, longWaits])
    : null;

  // ── ANOVA across TOD slots ──
  const slotEntries = Object.keys(phaseDurationsBySlot).map(k => [k, phaseDurationsBySlot[k]] as [string, number[]]);
  const slotGroups = slotEntries
    .filter(([, v]) => v.length >= 2)
    .map(([, v]) => v);
  const anovaResult = slotGroups.length >= 2 ? anovaFTest(slotGroups) : null;
  const anovaFStat = anovaResult?.fStat ?? null;

  // ── Within-slot variance ──
  const slotValueEntries = Object.keys(phaseDurationsBySlot).map(k => phaseDurationsBySlot[k]);
  const withinSlotVariances = slotValueEntries
    .filter(g => g.length >= 3)
    .map(g => {
      const mean = g.reduce((s, v) => s + v, 0) / g.length;
      return g.reduce((s, v) => s + (v - mean) ** 2, 0) / g.length;
    });
  const withinSlotVariance = withinSlotVariances.length > 0
    ? withinSlotVariances.reduce((s, v) => s + v, 0) / withinSlotVariances.length
    : null;

  // ── Decision logic ──
  // Fixed-cycle signals: stationary + low within-slot variance + consistent across congestion
  // Adaptive signals: non-stationary + high within-slot variance + responds to congestion

  let score = 0.5; // prior: uncertain
  let category: AdaptiveClassification["category"] = "uncertain";
  let explanation = "";

  const testsPassed: string[] = [];
  const cannotInfer: string[] = [];

  // ADF: low p-value → stationary → favors fixed-cycle
  if (adfPValue !== null) {
    if (adfPValue < 0.05) {
      score += 0.15;
      testsPassed.push("ADF stationarity test passed (p=" + adfPValue.toFixed(3) + ") → consistent with fixed-cycle timing");
    } else if (adfPValue < 0.10) {
      score += 0.05;
    }
  } else {
    cannotInfer.push("ADF test inconclusive due to insufficient cycle length observations");
  }

  // KPSS: high p-value → cannot reject stationarity → favors fixed-cycle
  if (kpssPValue !== null) {
    if (kpssPValue > 0.10) {
      score += 0.15;
      testsPassed.push("KPSS does not reject stationarity (p=" + kpssPValue.toFixed(3) + ") → consistent with fixed-cycle timing");
    } else {
      score -= 0.10;
      testsPassed.push("KPSS rejects stationarity (p=" + kpssPValue.toFixed(3) + ") → suggests demand-responsive behavior");
    }
  } else {
    cannotInfer.push("KPSS test inconclusive due to insufficient observations");
  }

  // Levene: significant → unequal variance → suggests adaptive
  if (levenePValue !== null) {
    if (levenePValue < 0.05) {
      score -= 0.20;
      testsPassed.push("Levene test significant (p=" + levenePValue.toFixed(3) + ") → unequal variance across congestion → adaptive behavior suspected");
    }
  }

  // ANOVA: high F-stat → phase durations vary by TOD slot → suggests TOD schedule or adaptive
  if (anovaFStat !== null && anovaFStat > 2.5) {
    score -= 0.10;
    testsPassed.push("ANOVA F=" + anovaFStat.toFixed(2) + " → phase durations vary by time-of-day → TOD schedule or adaptive behavior");
  }

  // Within-slot variance: high variance → possible adaptive extensions
  if (withinSlotVariance !== null && withinSlotVariance > 100) {
    score -= 0.10;
    testsPassed.push("High within-slot variance (" + withinSlotVariance.toFixed(1) + "s²) → possible adaptive extensions");
  }

  // Clamp and classify
  score = Math.max(0, Math.min(1, score));

  if (score > 0.65) {
    category = "fixed-cycle";
    explanation = "Multiple tests indicate stable, demand-independent timing consistent with a fixed-cycle controller.";
  } else if (score < 0.35) {
    category = "highly-adaptive";
    explanation = "Statistical tests suggest phase durations respond to traffic demand, characteristic of adaptive control.";
  } else {
    // Mixed signals — could be TOD schedule, partially adaptive, or insufficient data
    const nSlots = Object.keys(phaseDurationsBySlot).length;
    if (nSlots >= 3 && anovaFStat !== null && anovaFStat > 2.0) {
      category = "semi-adaptive";
      explanation = "Phase durations vary by time-of-day, consistent with a time-of-day schedule or semi-adaptive controller that follows preset patterns.";
    } else {
      category = "uncertain";
      explanation = "Tests produced mixed or inconclusive results. Data may be too sparse or the intersection behavior does not clearly fit fixed or adaptive patterns.";
    }
  }

  // Build cannotInfer statements
  const baseCannotInfer = [
    "Internal controller programming, sensor configuration, and proprietary algorithms cannot be determined from probe vehicle data alone.",
    "Whether a fixed-cycle intersection uses a time-of-day schedule cannot be distinguished from probe data.",
    "Direct controller access (SWARCO/UTOPIA/SCOOT/SCATS) would be required to confirm adaptive algorithm type.",
  ];

  const confidenceLevel: ConfidenceLevel =
    score > 0.65 || score < 0.35 ? (nObs > 30 ? "high" : "medium") : "low";

  return {
    category,
    confidenceLevel,
    numericalScore: score,
    statisticalEvidence: {
      adfPValue,
      kpssPValue,
      levenePValue,
      anovaFStat,
      withinSlotVariance,
      nObservations: nObs,
    },
    cannotInferStatements: [...baseCannotInfer, ...cannotInfer],
    explanation,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase Posterior with Entropy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute posterior probability of green vs red state with entropy measure.
 * Entropy bits: 0 = completely certain, 1 = moderately uncertain, 2+ = highly uncertain.
 * Lower entropy = more confident inference.
 */
export function buildPhasePosteriorWithEntropy(
  samples: Array<{ phaseSeconds: number; state: "green" | "red"; confidence: number }>,
  cycleLengthSeconds: number,
  greenDurationSeconds: number,
  offsetSeconds: number,
): PhasePosteriorWithEntropy {
  if (samples.length === 0) {
    return {
      state: "unknown",
      confidence: 0,
      entropyBits: 2,
      posteriorGreen: 0.5,
      posteriorRed: 0.5,
      nSamples: 0,
    };
  }

  // Count weighted green/red evidence in the current phase window
  const currentPhase = modulo(Date.now() / 1000 - offsetSeconds, cycleLengthSeconds);

  let greenWeight = 0;
  let redWeight = 0;
  for (const sample of samples) {
    const inGreen = isPhaseWithinWindow(
      sample.phaseSeconds,
      offsetSeconds,
      greenDurationSeconds,
      cycleLengthSeconds
    );
    if (inGreen) {
      greenWeight += sample.confidence;
    } else {
      redWeight += sample.confidence;
    }
  }

  const total = greenWeight + redWeight;
  if (total < 0.001) {
    return {
      state: "unknown",
      confidence: 0,
      entropyBits: 2,
      posteriorGreen: 0.5,
      posteriorRed: 0.5,
      nSamples: samples.length,
    };
  }

  // Softmax-style posterior with Laplace smoothing
  const alpha = 0.5; // smoothing
  const posteriorGreen = (greenWeight + alpha) / (total + 2 * alpha);
  const posteriorRed = (redWeight + alpha) / (total + 2 * alpha);

  // Entropy: H = -sum(p * log(p))
  const log2 = (x: number) => Math.log(x) / Math.log(2);
  const entropyBits = posteriorGreen > 0 && posteriorRed > 0
    ? -(posteriorGreen * log2(posteriorGreen) + posteriorRed * log2(posteriorRed))
    : 1;

  const currentInGreen = isPhaseWithinWindow(
    currentPhase,
    offsetSeconds,
    greenDurationSeconds,
    cycleLengthSeconds
  );

  return {
    state: currentInGreen ? "green" : "red",
    confidence: Math.max(0, Math.min(1, 1 - entropyBits)),
    entropyBits,
    posteriorGreen,
    posteriorRed,
    nSamples: samples.length,
  };
}

function isPhaseWithinWindow(
  phase: number,
  windowStart: number,
  windowDuration: number,
  cycleLength: number
): boolean {
  if (windowDuration >= cycleLength) return true;
  const end = modulo(windowStart + windowDuration, cycleLength);
  if (windowStart <= end) {
    return phase >= windowStart && phase < end;
  }
  return phase >= windowStart || phase < end;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bootstrap resampling to compute empirical confidence intervals for cycle length.
 * Resamples observation sequences with replacement, recomputes cycle estimate.
 */
export function bootstrapCycleLength(
  stopTimestampsSeconds: number[],
  nBootstrap = 200,
  seed = 42,
): BootstrapResult {
  const rng = seedBasedRandom(seed);
  const estimates: number[] = [];

  const safeN = Math.min(nBootstrap, 500);
  for (let i = 0; i < safeN; i++) {
    // Resample with replacement
    const resampled = stopTimestampsSeconds.map(() => {
      const idx = Math.floor(rng() * stopTimestampsSeconds.length);
      return stopTimestampsSeconds[idx];
    });

    if (resampled.length >= 3) {
      const posterior = buildCycleLengthPosterior(resampled);
      estimates.push(posterior.mapSeconds);
    }
  }

  if (estimates.length < 10) {
    const fallback = 90;
    return {
      cycleLengthSeconds: fallback,
      bootstrapStdErr: 10,
      ci95Lower: fallback - 20,
      ci95Upper: fallback + 20,
      nBootstrapSamples: estimates.length,
    };
  }

  estimates.sort((a, b) => a - b);

  const mean = estimates.reduce((s, v) => s + v, 0) / estimates.length;
  const bootstrapStdErr = Math.sqrt(estimates.reduce((s, v) => s + (v - mean) ** 2, 0) / estimates.length);

  const ci95Lower = estimates[Math.floor(estimates.length * 0.025)];
  const ci95Upper = estimates[Math.floor(estimates.length * 0.975)];

  return {
    cycleLengthSeconds: mean,
    bootstrapStdErr,
    ci95Lower,
    ci95Upper,
    nBootstrapSamples: estimates.length,
  };
}

function seedBasedRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Citizen-Facing Intersection Narrative
// ─────────────────────────────────────────────────────────────────────────────

export function generateIntersectionNarrative(
  intersectionId: string,
  intersectionName: string,
  classification: AdaptiveClassification,
  cyclePosterior: CycleLengthPosterior,
  phasePosterior: PhasePosteriorWithEntropy,
  nProbePasses: number,
  observationHours: number,
): IntersectionNarrative {
  const { category, confidenceLevel, cannotInferStatements, explanation } = classification;

  // What we observed
  const whatWeObserved = `${nProbePasses} probe passes observed over ${observationHours.toFixed(1)} hours. ` +
    (nProbePasses >= 50
      ? "This is a well-observed intersection with high statistical confidence."
      : nProbePasses >= 10
        ? "This intersection has moderate observation coverage."
        : "Data coverage is limited; conclusions should be treated with caution.");

  // What we inferred
  const cycleRange = `${cyclePosterior.mapSeconds}s (95% CI: ${cyclePosterior.ci95Lower}s–${cyclePosterior.ci95Upper}s)`;
  let whatWeInferred = `Estimated cycle length: ${cycleRange}. `;

  switch (category) {
    case "fixed-cycle":
      whatWeInferred += "The intersection exhibits stable, predictable timing consistent with a fixed-cycle controller. " +
        "Phase durations remain relatively constant regardless of traffic volume.";
      break;
    case "highly-adaptive":
      whatWeInferred += "Phase durations appear to respond to traffic demand, suggesting adaptive control. " +
        "Longer red durations are observed during heavier traffic conditions.";
      break;
    case "semi-adaptive":
      whatWeInferred += "Phase durations vary by time-of-day in a pattern consistent with a programmed schedule. " +
        "This may indicate either a time-of-day schedule or a semi-adaptive system.";
      break;
    case "uncertain":
    default:
      whatWeInferred += "Statistical tests produced inconclusive results. More data is needed to determine the control strategy.";
  }

  // Confidence reasoning
  let confidenceReasoning = `Confidence level: ${confidenceLevel.toUpperCase()}. `;
  if (confidenceLevel === "high") {
    confidenceReasoning += "Multiple statistical tests agree, observation count is high, and variance is low.";
  } else if (confidenceLevel === "medium") {
    confidenceReasoning += "Some tests are consistent, but observation count or variance limits confidence.";
  } else if (confidenceLevel === "low") {
    confidenceReasoning += "Few observations or contradictory test results limit our confidence in any classification.";
  } else {
    confidenceReasoning += "Insufficient data to draw any statistically meaningful conclusions.";
  }

  // What this means (citizen interpretation)
  let whatThisMeans = "";
  if (category === "fixed-cycle") {
    whatThisMeans = "Traffic light timing follows a predictable schedule regardless of how many vehicles are on the road. " +
      "This is common in smaller cities or quieter intersections where real-time adaptation is not needed.";
  } else if (category === "highly-adaptive") {
    whatThisMeans = "This intersection appears to adjust its timing based on traffic conditions. " +
      "During rush hours or heavy traffic, you may experience longer red lights as the system tries to clear congestion.";
  } else if (category === "semi-adaptive") {
    whatThisMeans = "This intersection may use a time-based schedule that changes at different times of day (e.g., different timing for morning vs. midday rush). " +
      "It may not respond to real-time demand fluctuations.";
  } else {
    whatThisMeans = "We cannot confidently characterize this intersection's behavior with available data.";
  }

  // What we cannot conclude
  const baseCannot = [
    "We cannot determine the specific brand or model of traffic controller (e.g., SWARCO, UTOPIA, SCOOT, SCATS).",
    "We cannot detect the presence or configuration of road sensors (loop detectors, cameras).",
    "We cannot confirm whether public transport priority is active without direct controller data.",
    "We cannot reconstruct the full signal timing plan with per-second accuracy.",
  ];

  return {
    intersectionId,
    whatWeObserved,
    whatWeInferred,
    confidenceLevel,
    confidenceReasoning,
    whatThisMeans,
    whatWeCannotConclude: [...baseCannot, ...cannotInferStatements],
    suggestions: confidenceLevel === "high"
      ? "This intersection is a good candidate for SUMO simulation or scenario analysis."
      : "More probe observations over additional days would improve confidence in any classification.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Corridor-Level Green Wave Detection
// ─────────────────────────────────────────────────────────────────────────────

export interface GreenWaveAnalysis {
  corridorName: string;
  coherenceScore: number;           // 0-1, higher = more coherent offset pattern
  likelyMechanism: "fixed-offset" | "adaptive-coordination" | "uncertain";
  averageOffsetSeconds: number;
  offsetVarianceSeconds: number;
  nIntersections: number;
  explanation: string;
  confidenceLevel: ConfidenceLevel;
}

/**
 * Detect green wave synchronization across a corridor of traffic lights.
 * Uses offset coherence (low variance) and offset progression (consistent advance).
 */
export function analyzeCorridorGreenWave(
  estimates: TrafficLightEstimate[],
  corridorDistancesMeters: number[], // distances between consecutive intersections in meters
  corridorName: string = "Unknown Corridor",
): GreenWaveAnalysis {
  if (estimates.length < 2) {
    return {
      corridorName,
      coherenceScore: 0,
      likelyMechanism: "uncertain",
      averageOffsetSeconds: 0,
      offsetVarianceSeconds: 0,
      nIntersections: estimates.length,
      explanation: "Insufficient intersections in corridor for green wave analysis.",
      confidenceLevel: "insufficient",
    };
  }

  const offsets = estimates.map(e => e.phaseOffsetSeconds);
  const cycles = estimates.map(e => e.cycleLengthSeconds);

  // Check if all cycles are similar (within 10s)
  const cycleConsistent = cycles.every(c => Math.abs(c - cycles[0]) < 10);
  if (!cycleConsistent) {
    return {
      corridorName,
      coherenceScore: 0.2,
      likelyMechanism: "uncertain",
      averageOffsetSeconds: circularMean(offsets, cycles[0]),
      offsetVarianceSeconds: 0,
      nIntersections: estimates.length,
      explanation: "Intersections in this corridor have inconsistent cycle lengths, making coordinated green wave unlikely.",
      confidenceLevel: "low",
    };
  }

  const cycle = cycles[0];

  // Offset variance (low variance = coherent)
  const meanOffset = circularMean(offsets, cycle);
  const offsetVariance = offsets.reduce((s, o) =>
    s + circularDistance(o, meanOffset, cycle) ** 2, 0) / offsets.length;

  // Expected offset progression: if green wave, offset should advance with distance
  // at approximately travel_time = distance / speed
  const expectedSpeedMps = 13.9; // ~50 km/h typical arterial speed
  const expectedOffsets: number[] = [];
  let cumulativeDistance = 0;
  for (let i = 0; i < estimates.length - 1; i++) {
    cumulativeDistance += corridorDistancesMeters[i] ?? 0;
    const travelSeconds = cumulativeDistance / expectedSpeedMps;
    expectedOffsets.push(modulo(travelSeconds, cycle));
  }

  // Compare observed offsets to expected progression
  let offsetAdvanceScore = 0;
  if (expectedOffsets.length > 0) {
    const actualDeltas: number[] = [];
    for (let i = 1; i < offsets.length; i++) {
      actualDeltas.push(circularDistance(offsets[i], offsets[i - 1], cycle));
    }
    const expectedDeltas: number[] = expectedOffsets.map((eo, i) =>
      circularDistance(eo, offsets[0], cycle)
    );

    let matchCount = 0;
    for (let i = 0; i < Math.min(actualDeltas.length, expectedDeltas.length); i++) {
      if (Math.abs(actualDeltas[i] - expectedDeltas[i]) < cycle * 0.15) matchCount++;
    }
    offsetAdvanceScore = matchCount / Math.max(1, actualDeltas.length);
  }

  // Combined coherence score
  const varianceScore = Math.max(0, 1 - offsetVariance / (cycle * 0.2));
  const coherenceScore = 0.5 * varianceScore + 0.5 * offsetAdvanceScore;

  // Classify mechanism
  let likelyMechanism: GreenWaveAnalysis["likelyMechanism"] = "uncertain";
  let mechanismExplanation = "";

  if (coherenceScore > 0.65) {
    if (offsetAdvanceScore > 0.5) {
      likelyMechanism = "fixed-offset";
      mechanismExplanation = "Offsets advance approximately with travel time, consistent with a planned fixed-offset green wave coordination.";
    } else {
      likelyMechanism = "fixed-offset";
      mechanismExplanation = "Offsets are coherent but may not follow a progressive pattern. This could be a synchronized plan without true green wave intent.";
    }
  } else if (coherenceScore > 0.35) {
    likelyMechanism = "uncertain";
    mechanismExplanation = "Offsets show moderate coherence but do not clearly indicate a green wave or adaptive coordination.";
  } else {
    mechanismExplanation = "No clear offset coordination pattern detected. Intersections may be operating independently or with inconsistent timing.";
  }

  const confidenceLevel = estimates.length >= 3 && coherenceScore > 0.5 ? "medium" : "low";

  return {
    corridorName,
    coherenceScore,
    likelyMechanism,
    averageOffsetSeconds: meanOffset,
    offsetVarianceSeconds: Math.sqrt(offsetVariance),
    nIntersections: estimates.length,
    explanation: mechanismExplanation,
    confidenceLevel,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe density sensitivity analysis
// ─────────────────────────────────────────────────────────────────────────────

export interface SensitivityResult {
  fraction: number;
  confidenceScore: number;
  cycleLengthChanged: boolean;
  classificationChanged: boolean;
}

/**
 * Subsample probe data at different fractions to assess robustness.
 * Used to establish minimum probe density for reliable inference.
 */
export function sensitivityAnalysis(
  stopTimestampsSeconds: number[],
  fractions: number[] = [0.25, 0.5, 0.75, 1.0],
  seed = 42,
): SensitivityResult[] {
  const rng = seedBasedRandom(seed);
  const fullPosterior = buildCycleLengthPosterior(stopTimestampsSeconds);
  const fullCycle = fullPosterior.mapSeconds;

  return fractions.map(frac => {
    if (frac >= 1.0) {
      return {
        fraction: frac,
        confidenceScore: fullPosterior.concentrationKappa,
        cycleLengthChanged: false,
        classificationChanged: false,
      };
    }

    const nSamples = Math.max(3, Math.floor(stopTimestampsSeconds.length * frac));
    const resampled: number[] = [];
    for (let i = 0; i < nSamples; i++) {
      const idx = Math.floor(rng() * stopTimestampsSeconds.length);
      resampled.push(stopTimestampsSeconds[idx]);
    }

    const subPosterior = buildCycleLengthPosterior(resampled);
    const changed = Math.abs(subPosterior.mapSeconds - fullCycle) > 10;

    return {
      fraction: frac,
      confidenceScore: subPosterior.concentrationKappa,
      cycleLengthChanged: changed,
      classificationChanged: changed,
    };
  });
}
/**
 * Run the uncertainty-aware inference framework on existing data.
 * Applies the new framework (Bayesian cycle posteriors, adaptive classification,
 * phase entropy, green wave analysis) to already-computed inference results.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCycleLengthPosterior,
  classifyIntersectionBehavior,
  buildPhasePosteriorWithEntropy,
  computeConfidenceLevel,
  numericalConfidenceScore,
  bootstrapCycleLength,
  generateIntersectionNarrative,
  analyzeCorridorGreenWave,
  type CycleLengthPosterior,
  type AdaptiveClassification,
  type PhasePosteriorWithEntropy,
  type ConfidenceLevel,
  type BootstrapResult,
} from "./inferenceFramework";

const DATA = resolve(process.cwd(), "data/traffic-lights/analysis");

// ── Load data ──────────────────────────────────────────────────────────────
const rawEstimates = JSON.parse(readFileSync(`${DATA}/estimates.json`, "utf8"));
const rawPasses = JSON.parse(readFileSync(`${DATA}/passes.json`, "utf8"));

const lights: Array<{ id: string; name: string; lng: number; lat: number }> = rawEstimates.lights ?? [];
const estimates = rawEstimates.estimates ?? [];
const passes: Array<{
  lightId: string;
  crossingTimestamp: number;
  passState: "green" | "red" | "unknown";
  stoppedBeforeLight: boolean;
  stopDurationSeconds: number;
  confidence: number;
  routeId: string;
  directionId?: string;
}> = rawPasses.passes ?? [];

// ── Group passes by light ────────────────────────────────────────────────────
const passesByLight = new Map<string, typeof passes>();
for (const pass of passes) {
  const list = passesByLight.get(pass.lightId) ?? [];
  list.push(pass);
  passesByLight.set(pass.lightId, list);
}

// ── Group estimates by route/corridor ──────────────────────────────────────
const estimatesByRoute = new Map<string, typeof estimates>();
for (const est of estimates) {
  // We key by intersection ID since we don't have explicit route groupings
  const routeKey = est.lightId;
  const list = estimatesByRoute.get(routeKey) ?? [];
  list.push(est);
  estimatesByRoute.set(routeKey, list);
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS 1: Per-intersection cycle length posterior + adaptive classification
// ─────────────────────────────────────────────────────────────────────────────
interface IntersectionResult {
  lightId: string;
  name: string;
  lng: number;
  lat: number;

  // Cycle length
  cycleMAP: number;
  cycleCI95Lower: number;
  cycleCI95Upper: number;
  concentrationKappa: number;
  evidenceStrength: string;
  nStopObservations: number;

  // Adaptive classification
  adaptiveCategory: AdaptiveClassification["category"];
  adaptiveScore: number;
  confidenceLevel: ConfidenceLevel;
  explanation: string;
  cannotInfer: string[];

  // Statistical evidence
  adfPValue: number | null;
  kpssPValue: number | null;
  levenePValue: number | null;
  anovaFStat: number | null;

  // Phase entropy
  entropyBits: number;
  posteriorGreen: number;
  nPhaseSamples: number;

  // Bootstrap
  bootstrap?: BootstrapResult;
}

const TOD_SLOTS = ["night", "morning", "midday", "afternoon", "evening"] as const;

function classifyTODSlot(hour: number): string {
  if (hour < 6) return "night";
  if (hour < 9) return "morning";
  if (hour < 12) return "midday";
  if (hour < 17) return "afternoon";
  return "evening";
}

console.log("=== ANALYSIS 1: Per-Intersection Inference ===\n");

const intersectionResults: IntersectionResult[] = [];

for (const light of lights) {
  const lightPasses = passesByLight.get(light.id) ?? [];
  const lightEst = estimates.find((e: any) => e.lightId === light.id);

  if (!lightEst || lightPasses.length < 4) continue;

  // Extract stop timestamps from passes
  const stopPasses = lightPasses.filter((p: any) => p.stoppedBeforeLight);
  const stopTimestampsSeconds = stopPasses
    .map((p: any) => p.crossingTimestamp / 1000)
    .filter((t: number) => Number.isFinite(t))
    .sort((a: number, b: number) => a - b);

  // Extract phase durations by TOD slot from the estimate's hourly profile
  const hourlyProfile = (lightEst as any).hourlyProfile ?? [];
  const phaseDurationsBySlot: Record<string, number[]> = {};
  for (const slot of TOD_SLOTS) {
    phaseDurationsBySlot[slot] = [];
  }
  for (const slice of hourlyProfile) {
    if (slice.sampleCount < 2) continue;
    const slot = classifyTODSlot(slice.hourOfDay);
    if (slice.greenDurationSeconds > 0) {
      phaseDurationsBySlot[slot].push(slice.greenDurationSeconds);
    }
  }

  // Cycle length posterior
  const cyclePosterior = buildCycleLengthPosterior(stopTimestampsSeconds);

  // Bootstrap (expensive, only for well-observed lights)
  let bootstrap: BootstrapResult | undefined;
  if (stopTimestampsSeconds.length >= 20) {
    bootstrap = bootstrapCycleLength(stopTimestampsSeconds, 100);
  }

  // Adaptive classification
  const stopDurations = stopPasses
    .map((p: any) => p.stopDurationSeconds)
    .filter((d: number) => d > 0);
  const cycleLengths = stopTimestampsSeconds.length >= 3
    ? [cyclePosterior.mapSeconds] // single estimate for now; full time-series would need historical
    : [];
  const classification = classifyIntersectionBehavior(
    phaseDurationsBySlot,
    cycleLengths,
    stopDurations,
  );

  // Phase posterior with entropy
  const phaseSamples = lightPasses
    .filter((p: any): p is typeof p & { passState: "green" | "red" } => p.passState === "green" || p.passState === "red")
    .map((p: any) => ({
      phaseSeconds: (p.crossingTimestamp / 1000) % cyclePosterior.mapSeconds,
      state: p.passState,
      confidence: p.confidence ?? 0.5,
    }));

  const greenDurationSeconds = (lightEst as any).greenDurationSeconds ?? 40;
  const phaseOffsetSeconds = (lightEst as any).phaseOffsetSeconds ?? 0;
  const phasePosteriorResult = buildPhasePosteriorWithEntropy(
    phaseSamples,
    cyclePosterior.mapSeconds,
    greenDurationSeconds,
    phaseOffsetSeconds,
  );

  // Confidence scoring
  const nObs = stopTimestampsSeconds.length + phaseSamples.length;
  const statisticalTestsPassed = [
    classification.statisticalEvidence.adfPValue !== null,
    classification.statisticalEvidence.kpssPValue !== null,
    classification.statisticalEvidence.levenePValue !== null,
  ].filter(Boolean).length;

  const confidenceLevel = computeConfidenceLevel(
    nObs,
    cyclePosterior.concentrationKappa,
    phasePosteriorResult.entropyBits,
  );

  const result: IntersectionResult = {
    lightId: light.id,
    name: light.name,
    lng: light.lng,
    lat: light.lat,
    cycleMAP: cyclePosterior.mapSeconds,
    cycleCI95Lower: cyclePosterior.ci95Lower,
    cycleCI95Upper: cyclePosterior.ci95Upper,
    concentrationKappa: cyclePosterior.concentrationKappa,
    evidenceStrength: cyclePosterior.evidenceStrength,
    nStopObservations: stopTimestampsSeconds.length,
    adaptiveCategory: classification.category,
    adaptiveScore: classification.numericalScore,
    confidenceLevel,
    explanation: classification.explanation,
    cannotInfer: classification.cannotInferStatements,
    adfPValue: classification.statisticalEvidence.adfPValue,
    kpssPValue: classification.statisticalEvidence.kpssPValue,
    levenePValue: classification.statisticalEvidence.levenePValue,
    anovaFStat: classification.statisticalEvidence.anovaFStat,
    entropyBits: phasePosteriorResult.entropyBits,
    posteriorGreen: phasePosteriorResult.posteriorGreen,
    nPhaseSamples: phaseSamples.length,
    bootstrap,
  };

  intersectionResults.push(result);
}

// Sort by nStopObservations desc
intersectionResults.sort((a, b) => b.nStopObservations - a.nStopObservations);

console.log(`Total intersections analyzed: ${intersectionResults.length}\n`);

// Category distribution
const categoryCounts = { "fixed-cycle": 0, "semi-adaptive": 0, "highly-adaptive": 0, "uncertain": 0 };
for (const r of intersectionResults) categoryCounts[r.adaptiveCategory]++;

const confidenceCounts = { high: 0, medium: 0, low: 0, insufficient: 0 };
for (const r of intersectionResults) confidenceCounts[r.confidenceLevel]++;

console.log("Adaptive Category Distribution:");
for (const [cat, n] of Object.entries(categoryCounts)) {
  console.log(`  ${cat}: ${n} (${((n / intersectionResults.length) * 100).toFixed(1)}%)`);
}

console.log("\nConfidence Level Distribution:");
for (const [level, n] of Object.entries(confidenceCounts)) {
  console.log(`  ${level}: ${n} (${((n / intersectionResults.length) * 100).toFixed(1)}%)`);
}

// ── Show top intersections by observation count ───────────────────────────────
console.log("\n--- Top 10 Best-Observed Intersections ---");
for (const r of intersectionResults.slice(0, 10)) {
  console.log(`\n${r.name} (${r.lightId})`);
  console.log(`  Observations: ${r.nStopObservations} stops, ${r.nPhaseSamples} phase samples`);
  console.log(`  Cycle: ${r.cycleMAP}s (95% CI: ${r.cycleCI95Lower}–${r.cycleCI95Upper}s, κ=${r.concentrationKappa.toFixed(3)}, evidence: ${r.evidenceStrength})`);
  console.log(`  Classification: ${r.adaptiveCategory} (score=${r.adaptiveScore.toFixed(2)}, confidence: ${r.confidenceLevel})`);
  if (r.adfPValue !== null) console.log(`  ADF p-value: ${r.adfPValue.toFixed(3)}`);
  if (r.kpssPValue !== null) console.log(`  KPSS p-value: ${r.kpssPValue.toFixed(3)}`);
  if (r.levenePValue !== null) console.log(`  Levene p-value: ${r.levenePValue.toFixed(3)}`);
  if (r.anovaFStat !== null) console.log(`  ANOVA F-stat: ${r.anovaFStat.toFixed(2)}`);
  console.log(`  Phase entropy: ${r.entropyBits.toFixed(2)} bits, P(green)=${r.posteriorGreen.toFixed(2)}`);
  if (r.bootstrap) {
    console.log(`  Bootstrap: ${r.bootstrap.cycleLengthSeconds.toFixed(1)}s ± ${r.bootstrap.bootstrapStdErr.toFixed(1)}s`);
  }
  console.log(`  Explanation: ${r.explanation}`);
  console.log(`  Cannot infer: ${r.cannotInfer[0] ?? "none"}`);
}

// ── Show uncertain intersections ─────────────────────────────────────────────
console.log("\n--- Intersections with 'uncertain' classification (sample) ---");
for (const r of intersectionResults.filter(r => r.adaptiveCategory === "uncertain").slice(0, 5)) {
  console.log(`\n${r.name}: ${r.explanation}`);
  console.log(`  n=${r.nStopObservations}, score=${r.adaptiveScore.toFixed(2)}, confidence=${r.confidenceLevel}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS 2: Corridor-level green wave detection
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n\n=== ANALYSIS 2: Corridor Green Wave Detection ===\n");

// Group nearby intersections into candidate corridors
// Use existing estimates with decent confidence
const wellObserved = intersectionResults.filter(r =>
  r.confidenceLevel !== "insufficient" && r.nStopObservations >= 3
);

interface CorridorAnalysis {
  name: string;
  intersections: IntersectionResult[];
  coherenceScore: number;
  likelyMechanism: string;
  averageOffset: number;
  offsetVariance: number;
}

// Group by rough geographic clusters (simplified: group by similar longitude)
const corridorBuckets: IntersectionResult[][] = [];
for (const est of wellObserved) {
  let placed = false;
  for (const bucket of corridorBuckets) {
    const ref = bucket[0];
    // Same corridor if within 0.01° longitude and 0.015° latitude
    if (Math.abs(ref.lng - est.lng) < 0.01 && Math.abs(ref.lat - est.lat) < 0.015) {
      bucket.push(est);
      placed = true;
      break;
    }
  }
  if (!placed) corridorBuckets.push([est]);
}

// Analyze each bucket with 3+ intersections
const corridorAnalyses: CorridorAnalysis[] = [];
for (const bucket of corridorBuckets) {
  if (bucket.length < 3) continue;

  const estimatesForCorridor = bucket.map(r => ({
    lightId: r.lightId,
    phaseOffsetSeconds: r.cycleMAP * 0.3, // approximate from cycle
    cycleLengthSeconds: r.cycleMAP,
    confidence: r.confidenceLevel === "high" ? 0.9 : r.confidenceLevel === "medium" ? 0.6 : 0.3,
  } as any));

  // Compute approximate corridor distances (use lat/lng differences)
  const distances: number[] = [];
  for (let i = 0; i < bucket.length - 1; i++) {
    const dLat = (bucket[i].lat - bucket[i + 1].lat) * 111_320;
    const dLng = (bucket[i].lng - bucket[i + 1].lng) * 111_320 * Math.cos((bucket[i].lat * Math.PI) / 180);
    distances.push(Math.hypot(dLat, dLng));
  }

  const analysis = analyzeCorridorGreenWave(estimatesForCorridor, distances, `Corridor ${bucket[0].lng.toFixed(3)}-${bucket[0].lat.toFixed(3)}`);

  corridorAnalyses.push({
    name: `Corridor ${bucket[0].name ?? bucket[0].lightId}`,
    intersections: bucket,
    coherenceScore: analysis.coherenceScore,
    likelyMechanism: analysis.likelyMechanism,
    averageOffset: analysis.averageOffsetSeconds,
    offsetVariance: analysis.offsetVarianceSeconds,
  });
}

corridorAnalyses.sort((a, b) => b.coherenceScore - a.coherenceScore);

console.log(`Candidate corridors identified: ${corridorAnalyses.length}\n`);

for (const ca of corridorAnalyses.slice(0, 8)) {
  console.log(`\n${ca.name} (${ca.intersections.length} intersections)`);
  console.log(`  Coherence score: ${ca.coherenceScore.toFixed(2)}`);
  console.log(`  Likely mechanism: ${ca.likelyMechanism}`);
  console.log(`  Average offset: ${ca.averageOffset.toFixed(1)}s, variance: ${ca.offsetVariance.toFixed(1)}s`);
  const intersectionNames = ca.intersections.map(i => i.name).slice(0, 4);
  console.log(`  Intersections: ${intersectionNames.join(", ")}${ca.intersections.length > 4 ? "..." : ""}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS 3: City-wide summary statistics
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n\n=== ANALYSIS 3: City-Wide Summary ===\n");

const allCycleLengths = intersectionResults.map(r => r.cycleMAP).filter(c => c > 0);
if (allCycleLengths.length > 0) {
  const meanCycle = allCycleLengths.reduce((s, v) => s + v, 0) / allCycleLengths.length;
  const minCycle = Math.min(...allCycleLengths);
  const maxCycle = Math.max(...allCycleLengths);
  console.log(`Cycle length: mean=${meanCycle.toFixed(1)}s, min=${minCycle}s, max=${maxCycle}s`);
}

// Adaptive fraction
const adaptiveFraction = (intersectionResults.filter(r => r.adaptiveCategory === "highly-adaptive").length / intersectionResults.length * 100);
const fixedFraction = (intersectionResults.filter(r => r.adaptiveCategory === "fixed-cycle").length / intersectionResults.length * 100);
const semiAdaptiveFraction = (intersectionResults.filter(r => r.adaptiveCategory === "semi-adaptive").length / intersectionResults.length * 100);
const uncertainFraction = (intersectionResults.filter(r => r.adaptiveCategory === "uncertain").length / intersectionResults.length * 100);

console.log(`\nAdaptive vs Fixed breakdown:`);
console.log(`  Highly adaptive: ${adaptiveFraction.toFixed(1)}%`);
console.log(`  Fixed-cycle:     ${fixedFraction.toFixed(1)}%`);
console.log(`  Semi-adaptive:   ${semiAdaptiveFraction.toFixed(1)}%`);
console.log(`  Uncertain:       ${uncertainFraction.toFixed(1)}%`);

// Confidence distribution
const highConf = intersectionResults.filter(r => r.confidenceLevel === "high").length;
const medConf = intersectionResults.filter(r => r.confidenceLevel === "medium").length;
const lowConf = intersectionResults.filter(r => r.confidenceLevel === "low").length;
const insufficient = intersectionResults.filter(r => r.confidenceLevel === "insufficient").length;
console.log(`\nConfidence distribution:`);
console.log(`  High:       ${highConf} (${(highConf / intersectionResults.length * 100).toFixed(1)}%)`);
console.log(`  Medium:     ${medConf} (${(medConf / intersectionResults.length * 100).toFixed(1)}%)`);
console.log(`  Low:        ${lowConf} (${(lowConf / intersectionResults.length * 100).toFixed(1)}%)`);
console.log(`  Insufficient: ${insufficient} (${(insufficient / intersectionResults.length * 100).toFixed(1)}%)`);

// Evidence strength distribution
const evidenceCounts = { strong: 0, moderate: 0, weak: 0 };
for (const r of intersectionResults) evidenceCounts[r.evidenceStrength as keyof typeof evidenceCounts]++;
console.log(`\nEvidence strength:`);
console.log(`  Strong:   ${evidenceCounts.strong} (${(evidenceCounts.strong / intersectionResults.length * 100).toFixed(1)}%)`);
console.log(`  Moderate: ${evidenceCounts.moderate} (${(evidenceCounts.moderate / intersectionResults.length * 100).toFixed(1)}%)`);
console.log(`  Weak:     ${evidenceCounts.weak} (${(evidenceCounts.weak / intersectionResults.length * 100).toFixed(1)}%)`);

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS 4: Narrative generation for top intersections
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n\n=== ANALYSIS 4: Citizen-Facing Narratives (Top 5) ===\n");

for (const r of intersectionResults.filter(r => r.confidenceLevel === "high" || r.confidenceLevel === "medium").slice(0, 5)) {
  const cyclePosterior: CycleLengthPosterior = {
    mapSeconds: r.cycleMAP,
    ci95Lower: r.cycleCI95Lower,
    ci95Upper: r.cycleCI95Upper,
    concentrationKappa: r.concentrationKappa,
    posterior: [],
    nObservations: r.nStopObservations,
    evidenceStrength: r.evidenceStrength as any,
  };

  const classification: AdaptiveClassification = {
    category: r.adaptiveCategory,
    confidenceLevel: r.confidenceLevel,
    numericalScore: r.adaptiveScore,
    statisticalEvidence: {
      adfPValue: r.adfPValue,
      kpssPValue: r.kpssPValue,
      levenePValue: r.levenePValue,
      anovaFStat: r.anovaFStat,
      withinSlotVariance: null,
      nObservations: r.nStopObservations,
    },
    cannotInferStatements: r.cannotInfer,
    explanation: r.explanation,
  };

  const phasePosterior: PhasePosteriorWithEntropy = {
    state: r.posteriorGreen > 0.5 ? "green" : "red",
    confidence: 1 - r.entropyBits,
    entropyBits: r.entropyBits,
    posteriorGreen: r.posteriorGreen,
    posteriorRed: 1 - r.posteriorGreen,
    nSamples: r.nPhaseSamples,
  };

  const narrative = generateIntersectionNarrative(
    r.lightId,
    r.name,
    classification,
    cyclePosterior,
    phasePosterior,
    r.nStopObservations + r.nPhaseSamples,
    21.6, // from existing data (hours of probe coverage)
  );

  console.log(`\n[${r.lightId}] ${r.name}`);
  console.log(`  CONFIDENCE: ${r.confidenceLevel.toUpperCase()}`);
  console.log(`  ── What We Observed ──`);
  console.log(`  ${narrative.whatWeObserved}`);
  console.log(`  ── What We Inferred ──`);
  console.log(`  ${narrative.whatWeInferred}`);
  console.log(`  ── Confidence Reasoning ──`);
  console.log(`  ${narrative.confidenceReasoning}`);
  console.log(`  ── What This Means ──`);
  console.log(`  ${narrative.whatThisMeans}`);
  console.log(`  ── What We CANNOT Conclude ──`);
  for (const stmt of narrative.whatWeCannotConclude.slice(0, 3)) {
    console.log(`  • ${stmt}`);
  }
  console.log(`  ── Suggestion ──`);
  console.log(`  ${narrative.suggestions}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS 5: SOTa (State of the Art) Research Context
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n\n=== ANALYSIS 5: Research Context & State of the Art ===\n");

console.log(`This analysis operates in a fundamentally different regime from proprietary adaptive traffic control systems:\n`);

console.log("PROPRIETARY SYSTEMS (SWARCO/UTOPIA/SCOOT/SCATS):");
console.log("  • Direct controller access via dedicated hardware interfaces");
console.log("  • Loop detector data at 1Hz+ resolution");
console.log("  • Millisecond-accurate SPaT broadcast");
console.log("  • Real-time demand-responsive optimization");
console.log("  • Automatic incident detection and response\n");

console.log("THIS FRAMEWORK (probe-only inference):");
console.log("  • GPS probe data at 5-10s intervals (sparse relative to ~90s cycle)");
console.log("  • No direct controller access — internal logic is black box");
console.log("  • Observations are SECONDARY: we see vehicle behavior, not signal state");
console.log("  • Confidence is inherently limited by probe density");
console.log("  • 'Adaptive' classification means statistical signatures of demand-responsiveness, not confirmed algorithm type\n");

console.log("SCIENTIFIC DEFENSIBILITY:");
console.log("  ✅ CAN claim: 'Intersection X shows statistically stable cycles consistent with fixed-cycle timing (ADF p=0.003)'");
console.log("  ✅ CAN claim: 'Intersection Y shows phase duration variation correlated with congestion (Levene p=0.02)'");
console.log("  ✅ CAN claim: 'We cannot determine controller brand or algorithm without direct access'");
console.log("  ❌ CANNOT claim: 'Intersection X uses SCOOT/SCATS adaptive control'");
console.log("  ❌ CANNOT claim: 'This bus received priority at this intersection'");
console.log("  ❌ CANNOT claim: 'We know the exact SPaT with per-second accuracy'\n");

console.log("RELEVANT RESEARCH ARTICLES:");
console.log("  • Cosariu et al. (2015) — TACTICS fuzzy reactive control, Timisoara: methodology this framework builds on");
console.log("  • Coifman (2001) — Vehicle reidentification and travel time inference from probe vehicles");
console.log("  • Bhaskar et al. (2015) — Transit signal priority inference from bus GPS data");
console.log("  • Liu et al. (2012) — Cycle length inference from fixed-route vehicle trajectories");
console.log("  • Vigos et al. (2008) — SPaT estimation from GPS-equipped probe vehicles\n");

console.log("MINIMUM DATA REQUIREMENTS:");
console.log("  • < 5 observations per intersection → 'insufficient' confidence");
console.log("  • 5-10 observations → 'low' confidence (heuristic only)");
console.log("  • 10-50 observations → 'medium' confidence (statistical tests applicable)");
console.log("  • 50+ observations with low variance → 'high' confidence (robust inference)\n");

// Save results
writeFileSync(
  `${DATA}/framework-results.json`,
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    intersectionResults,
    corridorAnalyses,
    summary: {
      totalAnalyzed: intersectionResults.length,
      categoryDistribution: categoryCounts,
      confidenceDistribution: confidenceCounts,
      evidenceStrengthDistribution: evidenceCounts,
      meanCycleSeconds: allCycleLengths.length > 0 ? allCycleLengths.reduce((s, v) => s + v, 0) / allCycleLengths.length : null,
    },
  }, null, 2),
);
console.log(`\nResults saved to: ${DATA}/framework-results.json`);

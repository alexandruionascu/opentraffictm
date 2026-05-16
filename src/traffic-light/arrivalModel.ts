// Inline geo utilities (avoid import issues with TypeScript-only files)
function haversineMeters(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const v =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(1 - v));
}

function bearingDegrees(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

function angleDifferenceDegrees(a: number, b: number) {
  const diff = Math.abs(((a - b) % 360 + 360) % 360);
  return diff > 180 ? 360 - diff : diff;
}

function modulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queryAllProbeSegments } from "../stpt-probe";
import type { SignalProgram } from "../data";

interface SignalsJson {
  programs: Array<{
    id: string;
    name: string;
    position: { lng: number; lat: number };
    primaryHeadingDeg: number;
    offsetSeconds: number;
    phases: Array<{ state: string; durationSeconds: number }>;
    osmId?: number;
    sampleCount?: number;
  }>;
}

const __dirname = ".";
const signalsJsonRaw = JSON.parse(readFileSync(join(__dirname, "../../data/traffic-lights/signals.json"), "utf-8")) as { programs: Array<{ id: string; name: string; position: { lng: number; lat: number }; primaryHeadingDeg: number; offsetSeconds: number; phases: Array<{ state: string; durationSeconds: number }>; osmId?: number; sampleCount?: number }> };
const signalPrograms: SignalProgram[] = signalsJsonRaw.programs.map((p) => ({
  id: p.id,
  name: p.name,
  position: p.position,
  primaryHeadingDeg: p.primaryHeadingDeg,
  offsetSeconds: p.offsetSeconds,
  phases: p.phases as SignalProgram["phases"],
  osmId: p.osmId,
  sampleCount: p.sampleCount,
}));

export const TIME_SLOTS = [
  "night",
  "morning-rush",
  "mid-morning",
  "midday",
  "afternoon-rush",
  "evening",
  "late-night",
] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

export function classifySlot(hour: number): TimeSlot {
  if (hour >= 0 && hour < 6) return "night";
  if (hour >= 6 && hour < 8) return "morning-rush";
  if (hour >= 8 && hour < 10) return "mid-morning";
  if (hour >= 10 && hour < 14) return "midday";
  if (hour >= 14 && hour < 17) return "afternoon-rush";
  if (hour >= 17 && hour < 21) return "evening";
  return "late-night";
}

export interface ProbeObservation {
  route: string;
  vehicleId: string;
  speedKph: number;
  distanceMeters: number;
  timeDeltaSeconds: number;
  delaySeconds: number;
  serverTimestamp: number;
  geometry: [number, number][];
}

export interface ApproachSample {
  signalId: string;
  signalPosition: { lng: number; lat: number };
  headingDeg: number;
  timeSlot: TimeSlot;
  speedKph: number;
  delaySeconds: number;
  approachAngleDeg: number;
  distanceToSignalMeters: number;
  vehicleId: string;
  timestamp: number;
}

export interface ApproachStats {
  signalId: string;
  signalName: string;
  timeSlot: TimeSlot;
  sampleCount: number;
  speedsKph: number[];
  avgSpeedKph: number;
  stdSpeedKph: number;
  minSpeedKph: number;
  maxSpeedKph: number;
  avgDelaySeconds: number;
  freeFlowSpeedKph: number;
  speedRatio: number;
  regime: "free" | "light" | "heavy" | "blocked";
  geometricMean: number;
  geometricStd: number;
}

export interface FittedDistribution {
  type: "gamma" | "lognormal";
  shape: number;
  scale: number;
  mean: number;
  variance: number;
  stdDev: number;
  ksStat: number;
  ksPValue: number;
  fitOk: boolean;
}

export interface ApproachDistribution {
  signalId: string;
  signalName: string;
  timeSlot: TimeSlot;
  sampleCount: number;
  nSpeed: number;
  freeFlowSpeedKph: number;
  speedRatio: number;
  regime: "free" | "light" | "heavy" | "blocked";
  gamma: FittedDistribution;
  lognormal: FittedDistribution;
  bestFit: "gamma" | "lognormal";
  byVehicleCount: number;
  byRouteCount: number;
}

export interface ArrivalModelOutput {
  generatedAt: string;
  scope: string;
  totalSignals: number;
  totalApproaches: number;
  fittedApproaches: number;
  signalsWithData: number;
  approaches: ApproachDistribution[];
  cityWideSpeedDistribution: FittedDistribution;
  cityWideSpeedRatioBySlot: Record<TimeSlot, { avgSpeedRatio: number; sampleCount: number }>;
}

const REGIME_THRESHOLDS = { free: 0.85, light: 0.65, heavy: 0.40 };
const APPROACH_RADIUS_METERS = 150;
const MAX_APPROACH_DISTANCE_METERS = 250;
const HEADING_TOLERANCE_DEG = 90;

function classifyRegime(speedRatio: number): "free" | "light" | "heavy" | "blocked" {
  if (speedRatio >= REGIME_THRESHOLDS.free) return "free";
  if (speedRatio >= REGIME_THRESHOLDS.light) return "light";
  if (speedRatio >= REGIME_THRESHOLDS.heavy) return "heavy";
  return "blocked";
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function geometricMean(values: number[]): number {
  if (!values.length) return 0;
  const logSum = values.reduce((a, v) => a + Math.log(Math.max(v, 0.001)), 0);
  return Math.exp(logSum / values.length);
}

function geometricStd(values: number[]): number {
  if (values.length < 2) return 0;
  const gm = geometricMean(values);
  const logVals = values.map((v) => Math.log(Math.max(v, 0.001) / gm) ** 2);
  return Math.exp(Math.sqrt(logVals.reduce((a, b) => a + b, 0) / logVals.length));
}

function fitGamma(speeds: number[]): FittedDistribution {
  if (speeds.length < 4) {
    return { type: "gamma", shape: 1, scale: 1, mean: 0, variance: 0, stdDev: 0, ksStat: 1, ksPValue: 0, fitOk: false };
  }
  const logSpeeds = speeds.map((v) => Math.log(Math.max(v, 0.001)));
  const n = speeds.length;
  const meanLog = logSpeeds.reduce((a, b) => a + b, 0) / n;
  const varLog = logSpeeds.reduce((a, b) => a + (b - meanLog) ** 2, 0) / n;
  const mean = speeds.reduce((a, b) => a + b, 0) / n;
  const variance = speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  const shape = mean ** 2 / (variance + 0.001);
  const scale = (variance + 0.001) / mean;

  const ks = kolmogorovSmirnov(speeds, (v) => gammaCdf(v, shape, scale));
  return {
    type: "gamma",
    shape: Math.round(shape * 100) / 100,
    scale: Math.round(scale * 100) / 100,
    mean: Math.round(mean * 10) / 10,
    variance: Math.round(variance * 10) / 10,
    stdDev: Math.round(stdDev * 10) / 10,
    ksStat: Math.round(ks.stat * 100) / 100,
    ksPValue: Math.round(ks.pValue * 1000) / 1000,
    fitOk: ks.pValue > 0.01,
  };
}

function fitLognormal(speeds: number[]): FittedDistribution {
  if (speeds.length < 4) {
    return { type: "lognormal", shape: 1, scale: 1, mean: 0, variance: 0, stdDev: 0, ksStat: 1, ksPValue: 0, fitOk: false };
  }
  const logSpeeds = speeds.map((v) => Math.log(Math.max(v, 0.001)));
  const n = speeds.length;
  const meanLog = logSpeeds.reduce((a, b) => a + b, 0) / n;
  const stdLog = Math.sqrt(logSpeeds.reduce((a, b) => a + (b - meanLog) ** 2, 0) / n);

  const mu = meanLog;
  const sigma = stdLog;
  const mean = Math.exp(mu + sigma ** 2 / 2);
  const variance = (Math.exp(sigma ** 2) - 1) * Math.exp(2 * mu + sigma ** 2);
  const stdDev = Math.sqrt(variance);

  const ks = kolmogorovSmirnov(speeds, (v) => lognormalCdf(v, mu, sigma));
  return {
    type: "lognormal",
    shape: Math.round(mu * 100) / 100,
    scale: Math.round(sigma * 100) / 100,
    mean: Math.round(mean * 10) / 10,
    variance: Math.round(variance * 10) / 10,
    stdDev: Math.round(stdDev * 10) / 10,
    ksStat: Math.round(ks.stat * 100) / 100,
    ksPValue: Math.round(ks.pValue * 1000) / 1000,
    fitOk: ks.pValue > 0.01,
  };
}

function gammaCdf(x: number, shape: number, scale: number): number {
  return gammaLowerRegularized(shape, x / scale);
}

function lognormalCdf(x: number, mu: number, sigma: number): number {
  if (x <= 0) return 0;
  const z = (Math.log(x) - mu) / (sigma + 0.001);
  return erf(z / Math.sqrt(2));
}

function erf(x: number): number {
  const t = 1 / (1 + Math.abs(x) * 0.5);
  const tau = t * Math.exp(-x * x - 1.26551223 + t * (1.56418833 + t * (-0.72143368 + t * (0.12736245 + t * (-0.27018111 + t * 0.04298773)))));
  return x >= 0 ? 1 - tau : tau - 1;
}

function gammaLowerRegularized(s: number, x: number): number {
  if (x < 0 || s <= 0) return 0;
  if (x === 0) return 0;
  if (x < s + 1) {
    let sum = 1 / s;
    let term = 1 / s;
    for (let n = 1; n <= 100; n++) {
      term *= x / (s + n);
      sum += term;
      if (Math.abs(term) < 1e-10) break;
    }
    return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
  }
  let b = x + 1 - s;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let n = 1; n <= 100; n++) {
    const an = -n * (n - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-10) break;
  }
  return Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
}

function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.22309815874351, -1.1637399532219247, 0.00138719888958038, -0.0000025192502];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    ser += c[j] / ++y;
  }
  return -tmp + Math.log((2.5066282746310005 / x) * ser);
}

function kolmogorovSmirnov(
  values: number[],
  cdfFn: (v: number) => number,
): { stat: number; pValue: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  let maxD = 0;
  for (let i = 0; i < n; i++) {
    const F = cdfFn(sorted[i]);
    const D = Math.max(Math.abs((i + 1) / n - F), Math.abs(i / n - F));
    if (D > maxD) maxD = D;
  }
  const pValue = Math.max(0, 1 - kolmogorovSmirnovCdf(Math.sqrt(n) * maxD, n));
  return { stat: maxD, pValue };
}

function kolmogorovSmirnovCdf(z: number, n: number): number {
  if (z < 0) return 0;
  if (z === 0) return 0;
  let sum = 0;
  for (let k = 1; k <= Math.floor(n * (1 - z)); k++) {
    sum += binomial(n, k) * (1 - z) ** (n - k) * z ** k * Math.exp(-2 * n * z ** 2 * k ** 2);
  }
  return Math.min(1, Math.exp(-2 * n * z ** 2) + sum);
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  return result;
}

export function sampleDistribution(
  dist: FittedDistribution,
  count: number,
): number[] {
  const samples: number[] = [];
  for (let i = 0; i < count; i++) {
    samples.push(sampleFromDistribution(dist));
  }
  return samples;
}

function sampleFromDistribution(dist: FittedDistribution): number {
  const u = Math.random();
  if (dist.type === "gamma") {
    return sampleGamma(dist.shape, dist.scale);
  } else {
    return sampleLognormal(dist.shape, dist.scale);
  }
}

function sampleGamma(shape: number, scale: number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1, scale) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = normalSample();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) ** 2) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

function sampleLognormal(mu: number, sigma: number): number {
  return Math.exp(mu + sigma * normalSample());
}

function normalSample(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function matchProbeToApproaches(
  probes: ProbeObservation[],
  maxDistanceMeters = MAX_APPROACH_DISTANCE_METERS,
  radiusMeters = APPROACH_RADIUS_METERS,
): ApproachSample[] {
  const samples: ApproachSample[] = [];

  for (const probe of probes) {
    for (const signal of signalPrograms) {
      const distToSignal = haversineMeters(
        { lng: probe.geometry[0][0], lat: probe.geometry[0][1] },
        signal.position,
      );

      if (distToSignal > radiusMeters) continue;

      const probeHeading = bearingDegrees(
        { lng: probe.geometry[0][0], lat: probe.geometry[0][1] },
        { lng: probe.geometry[1][0], lat: probe.geometry[1][1] },
      );
      const headingDiff = angleDifferenceDegrees(probeHeading, signal.primaryHeadingDeg ?? 0);

      if (headingDiff > HEADING_TOLERANCE_DEG) continue;

      const hour = new Date(probe.serverTimestamp).getHours();
      const timeSlot = classifySlot(hour);

      samples.push({
        signalId: signal.id,
        signalPosition: signal.position,
        headingDeg: signal.primaryHeadingDeg ?? 0,
        timeSlot,
        speedKph: probe.speedKph,
        delaySeconds: probe.delaySeconds,
        approachAngleDeg: headingDiff,
        distanceToSignalMeters: distToSignal,
        vehicleId: probe.vehicleId,
        timestamp: probe.serverTimestamp,
      });
    }
  }

  return samples;
}

export function buildApproachStats(samples: ApproachSample[]): ApproachStats[] {
  const byKey = new Map<string, ApproachSample[]>();

  for (const s of samples) {
    const key = `${s.signalId}__${s.timeSlot}`;
    const list = byKey.get(key) ?? [];
    list.push(s);
    byKey.set(key, list);
  }

  const stats: ApproachStats[] = [];
  const signalMap = new Map(signalPrograms.map((s) => [s.id, s]));

  for (const [key, group] of byKey.entries()) {
    if (group.length < 3) continue;

    const [signalId, timeSlot] = key.split("__");
    const signal = signalMap.get(signalId);
    if (!signal) continue;

    const speeds = group.map((s) => s.speedKph);
    const delays = group.map((s) => s.delaySeconds);
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
    const stdSpeed = Math.sqrt(speeds.reduce((a, s) => a + (s - avgSpeed) ** 2, 0) / speeds.length);
    const freeFlow = percentile(speeds, 85);
    const speedRatio = freeFlow > 0 ? avgSpeed / freeFlow : 0;

    stats.push({
      signalId,
      signalName: signal.name,
      timeSlot: timeSlot as TimeSlot,
      sampleCount: group.length,
      speedsKph: speeds,
      avgSpeedKph: Math.round(avgSpeed * 10) / 10,
      stdSpeedKph: Math.round(stdSpeed * 10) / 10,
      minSpeedKph: Math.min(...speeds),
      maxSpeedKph: Math.max(...speeds),
      avgDelaySeconds: Math.round(avgDelay * 10) / 10,
      freeFlowSpeedKph: Math.round(freeFlow * 10) / 10,
      speedRatio: Math.round(speedRatio * 1000) / 1000,
      regime: classifyRegime(speedRatio),
      geometricMean: Math.round(geometricMean(speeds) * 10) / 10,
      geometricStd: Math.round(geometricStd(speeds) * 10) / 10,
    });
  }

  return stats;
}

export function fitDistributionsForApproach(stats: ApproachStats): ApproachDistribution | null {
  if (stats.sampleCount < 3) return null;

  const speeds = stats.speedsKph;
  const gamma = fitGamma(speeds);
  const lognormal = fitLognormal(speeds);
  const bestFit = gamma.ksPValue >= lognormal.ksPValue ? "gamma" : "lognormal";

  const vehicleSet = new Set<string>();
  const routeSet = new Set<string>();

  return {
    signalId: stats.signalId,
    signalName: stats.signalName,
    timeSlot: stats.timeSlot,
    sampleCount: stats.sampleCount,
    nSpeed: speeds.length,
    freeFlowSpeedKph: stats.freeFlowSpeedKph,
    speedRatio: stats.speedRatio,
    regime: stats.regime,
    gamma,
    lognormal,
    bestFit,
    byVehicleCount: vehicleSet.size,
    byRouteCount: routeSet.size,
  };
}

export async function buildArrivalModel(probes: ProbeObservation[]): Promise<ArrivalModelOutput> {
  const samples = matchProbeToApproaches(probes);

  const stats = buildApproachStats(samples);

  const approaches: ApproachDistribution[] = [];
  const signalSet = new Set<string>();
  const slotSpeeds: Record<string, number[]> = {};

  for (const s of stats) {
    const fitted = fitDistributionsForApproach(s);
    if (fitted) {
      approaches.push(fitted);
      signalSet.add(s.signalId);

      if (!slotSpeeds[s.timeSlot]) slotSpeeds[s.timeSlot] = [];
      slotSpeeds[s.timeSlot].push(...s.speedsKph);
    }
  }

  const allSpeeds = approaches.flatMap((a) => {
    const speeds: number[] = [];
    for (let i = 0; i < a.sampleCount; i++) {
      speeds.push(a.gamma.mean);
    }
    return speeds;
  });

  const cityWide = fitGamma(allSpeeds.length > 0 ? allSpeeds : [18]);

  const cityWideSpeedRatioBySlot: Record<string, { avgSpeedRatio: number; sampleCount: number }> = {};
  for (const slot of TIME_SLOTS) {
    const sp = slotSpeeds[slot];
    if (sp && sp.length > 0) {
      const freeFlow = percentile(sp, 85);
      const avgSpeed = sp.reduce((a, b) => a + b, 0) / sp.length;
      cityWideSpeedRatioBySlot[slot] = {
        avgSpeedRatio: Math.round((avgSpeed / (freeFlow + 0.001)) * 1000) / 1000,
        sampleCount: sp.length,
      };
    } else {
      cityWideSpeedRatioBySlot[slot] = { avgSpeedRatio: 1, sampleCount: 0 };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    scope: "STPT probe-to-intersection arrival model for Timișoara",
    totalSignals: signalPrograms.length,
    totalApproaches: signalPrograms.length * TIME_SLOTS.length,
    fittedApproaches: approaches.length,
    signalsWithData: signalSet.size,
    approaches,
    cityWideSpeedDistribution: cityWide,
    cityWideSpeedRatioBySlot: cityWideSpeedRatioBySlot as Record<TimeSlot, { avgSpeedRatio: number; sampleCount: number }>,
  };
}

export async function main() {
  const { queryAllProbeSegments } = await import("../stpt-probe");

  console.log("Loading probe segments...");
  const probes = await queryAllProbeSegments();
  console.log(`Loaded ${probes.length} probe segments`);

  console.log("Matching probes to signal approaches...");
  const samples = matchProbeToApproaches(probes);
  console.log(`Matched ${samples.length} approach samples`);

  const stats = buildApproachStats(samples);
  console.log(`Built stats for ${stats.length} approach-time-slot combinations`);

  const output = await buildArrivalModel(probes);

  const { mkdirSync, writeFileSync } = await import("fs");
  mkdirSync("data/derived", { recursive: true });
  writeFileSync("data/derived/arrival-model.json", JSON.stringify(output, null, 2));

  console.log(`\n=== Arrival Model Summary ===`);
  console.log(`Signals: ${output.totalSignals}, Approaches fitted: ${output.fittedApproaches}`);
  console.log(`Signals with data: ${output.signalsWithData}`);
  console.log(`\nCity-wide speed ratio by time slot:`);
  for (const [slot, data] of Object.entries(output.cityWideSpeedRatioBySlot)) {
    console.log(`  ${slot}: ${data.avgSpeedRatio}x (${data.sampleCount} samples)`);
  }

  if (output.approaches.length > 0) {
    const heavy = output.approaches.filter((a) => a.regime === "heavy" || a.regime === "blocked");
    console.log(`\nHeavy/blocked approaches: ${heavy.length}`);
    console.log("Top 5 slowest approaches:");
    const sorted = [...output.approaches].sort((a, b) => a.speedRatio - b.speedRatio);
    for (const app of sorted.slice(0, 5)) {
      console.log(`  ${app.signalId} [${app.timeSlot}]: ${app.speedRatio}x, ${app.sampleCount} samples, best fit: ${app.bestFit}`);
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}

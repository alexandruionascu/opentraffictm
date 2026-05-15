// src/traffic-light/arrivalModel.mjs
// Fits arrival distributions from STPT probes to intersection approaches
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = "stpt.db";
const SIGNALS_PATH = "data/traffic-lights/signals.json";
const OUTPUT_PATH = "data/derived/arrival-model.json";

const APPROACH_RADIUS_METERS = 150;
const HEADING_TOLERANCE_DEG = 90;
const MAX_APPROACH_DISTANCE_METERS = 250;
const NOMINAL_BUS_SPEED_KPH = 18;

const TIME_SLOTS = ["night", "morning-rush", "mid-morning", "midday", "afternoon-rush", "evening", "late-night"];

function classifySlot(hour) {
  if (hour >= 0 && hour < 6) return "night";
  if (hour >= 6 && hour < 8) return "morning-rush";
  if (hour >= 8 && hour < 10) return "mid-morning";
  if (hour >= 10 && hour < 14) return "midday";
  if (hour >= 14 && hour < 17) return "afternoon-rush";
  if (hour >= 17 && hour < 21) return "evening";
  return "late-night";
}

function haversineMeters(a, b) {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const v = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(1 - v));
}

function bearingDegrees(a, b) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const lat1 = a.lat * toRad, lat2 = b.lat * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

function angleDifferenceDegrees(a, b) {
  const diff = Math.abs(((a - b) % 360 + 360) % 360);
  return diff > 180 ? 360 - diff : diff;
}

function computeDelay(speedKph) {
  if (speedKph <= 0) return 60;
  return Math.max(0, NOMINAL_BUS_SPEED_KPH - speedKph) * 3.6;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx), upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function geometricMean(values) {
  if (!values.length) return 0;
  const logSum = values.reduce((a, v) => a + Math.log(Math.max(v, 0.001)), 0);
  return Math.exp(logSum / values.length);
}

function geometricStd(values) {
  if (values.length < 2) return 0;
  const gm = geometricMean(values);
  const logVals = values.map((v) => Math.log(Math.max(v, 0.001) / gm) ** 2);
  return Math.exp(Math.sqrt(logVals.reduce((a, b) => a + b, 0) / logVals.length));
}

function classifyRegime(speedRatio) {
  if (speedRatio >= 0.85) return "free";
  if (speedRatio >= 0.65) return "light";
  if (speedRatio >= 0.40) return "heavy";
  return "blocked";
}

// Gamma CDF via regularized lower incomplete gamma
function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.22309815874351, -1.1637399532219247, 0.00138719888958038, -0.0000025192502];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 / x) * ser);
}

function gammaCdf(x, shape, scale) {
  if (x < 0 || shape <= 0) return 0;
  if (x === 0) return 0;
  return gammaLowerRegularized(shape, x / scale);
}

function gammaLowerRegularized(s, x) {
  if (x < 0 || s <= 0) return 0;
  if (x === 0) return 0;
  if (x < s + 1) {
    let sum = 1 / s, term = 1 / s;
    for (let n = 1; n <= 100; n++) {
      term *= x / (s + n);
      sum += term;
      if (Math.abs(term) < 1e-10) break;
    }
    return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
  }
  let b = x + 1 - s, c = 1 / 1e-30, d = 1 / b, h = d;
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

function erf(x) {
  const t = 1 / (1 + Math.abs(x) * 0.5);
  const tau = t * Math.exp(-x * x - 1.26551223 + t * (1.56418833 + t * (-0.72143368 + t * (0.12736245 + t * (-0.27018111 + t * 0.04298773)))));
  return x >= 0 ? 1 - tau : tau - 1;
}

function lognormalCdf(x, mu, sigma) {
  if (x <= 0) return 0;
  return erf((Math.log(x) - mu) / (sigma + 0.001) / Math.sqrt(2));
}

function kolmogorovSmirnov(values, cdfFn) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  let maxD = 0;
  for (let i = 0; i < n; i++) {
    const F = cdfFn(sorted[i]);
    const D = Math.max(Math.abs((i + 1) / n - F), Math.abs(i / n - F));
    if (D > maxD) maxD = D;
  }
  const pValue = Math.max(0, 1 - kolmogorovCdf(Math.sqrt(n) * maxD));
  return { stat: maxD, pValue };
}

function kolmogorovCdf(z) {
  if (z < 0) return 0;
  if (z === 0) return 0;
  let sum = 0;
  for (let k = 1; k <= Math.floor(20); k++) {
    sum += Math.exp(-2 * z ** 2 * k ** 2);
  }
  return Math.min(1, Math.exp(-2 * z ** 2) * (1 + 2 * sum));
}

function fitGamma(speeds) {
  if (speeds.length < 4) return { type: "gamma", shape: 0, scale: 0, mean: 0, variance: 0, stdDev: 0, ksStat: 1, ksPValue: 0, fitOk: false };
  const n = speeds.length;
  const mean = speeds.reduce((a, b) => a + b, 0) / n;
  const variance = speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const shape = mean ** 2 / (variance + 0.001);
  const scale = (variance + 0.001) / mean;
  const ks = kolmogorovSmirnov(speeds, (v) => gammaCdf(v, shape, scale));
  return { type: "gamma", shape: Math.round(shape * 100) / 100, scale: Math.round(scale * 100) / 100, mean: Math.round(mean * 10) / 10, variance: Math.round(variance * 10) / 10, stdDev: Math.round(stdDev * 10) / 10, ksStat: Math.round(ks.stat * 100) / 100, ksPValue: Math.round(ks.pValue * 1000) / 1000, fitOk: ks.pValue > 0.01 };
}

function fitLognormal(speeds) {
  if (speeds.length < 4) return { type: "lognormal", shape: 0, scale: 0, mean: 0, variance: 0, stdDev: 0, ksStat: 1, ksPValue: 0, fitOk: false };
  const logSpeeds = speeds.map((v) => Math.log(Math.max(v, 0.001)));
  const n = speeds.length;
  const meanLog = logSpeeds.reduce((a, b) => a + b, 0) / n;
  const stdLog = Math.sqrt(logSpeeds.reduce((a, b) => a + (b - meanLog) ** 2, 0) / n);
  const mean = Math.exp(meanLog + stdLog ** 2 / 2);
  const variance = (Math.exp(stdLog ** 2) - 1) * Math.exp(2 * meanLog + stdLog ** 2);
  const stdDev = Math.sqrt(variance);
  const ks = kolmogorovSmirnov(speeds, (v) => lognormalCdf(v, meanLog, stdLog));
  return { type: "lognormal", shape: Math.round(meanLog * 100) / 100, scale: Math.round(stdLog * 100) / 100, mean: Math.round(mean * 10) / 10, variance: Math.round(variance * 10) / 10, stdDev: Math.round(stdDev * 10) / 10, ksStat: Math.round(ks.stat * 100) / 100, ksPValue: Math.round(ks.pValue * 1000) / 1000, fitOk: ks.pValue > 0.01 };
}

function normalSample() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleGamma(shape, scale) {
  if (shape < 1) return sampleGamma(shape + 1, scale) * Math.pow(Math.random(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x, v;
    do { x = normalSample(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) ** 2) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

function sampleLognormal(mu, sigma) {
  return Math.exp(mu + sigma * normalSample());
}

function sampleDistribution(dist, count) {
  const samples = [];
  for (let i = 0; i < count; i++) {
    if (dist.type === "gamma") samples.push(sampleGamma(dist.shape, dist.scale));
    else samples.push(sampleLognormal(dist.shape, dist.scale));
  }
  return samples;
}

// Load signals
const signalsData = JSON.parse(readFileSync(SIGNALS_PATH, "utf-8"));
const signalPrograms = signalsData.programs.map((p) => ({
  id: p.id, name: p.name, position: p.position,
  primaryHeadingDeg: p.primaryHeadingDeg, offsetSeconds: p.offsetSeconds,
  phases: p.phases, osmId: p.osmId, sampleCount: p.sampleCount,
}));

console.log(`Loaded ${signalPrograms.length} signal programs`);

// Load probe segments from SQLite
const db = new DatabaseSync(DB_PATH, { readonly: true });

const rows = db.prepare(`
  WITH paired AS (
    SELECT id, route, lat, lng, speed, server_timestamp,
           LAG(lat) OVER (PARTITION BY id ORDER BY server_timestamp) as prev_lat,
           LAG(lng) OVER (PARTITION BY id ORDER BY server_timestamp) as prev_lng,
           LAG(server_timestamp) OVER (PARTITION BY id ORDER BY server_timestamp) as prev_ts
    FROM vehicle_positions
    WHERE server_timestamp IS NOT NULL AND lat IS NOT NULL AND lng IS NOT NULL
  )
  SELECT id, route, lat, lng, prev_lat, prev_lng, speed, server_timestamp, prev_ts,
         (server_timestamp - prev_ts) / 1000.0 as time_delta_sec
  FROM paired
  WHERE prev_lat IS NOT NULL AND prev_lng IS NOT NULL
    AND prev_ts IS NOT NULL AND time_delta_sec > 0 AND time_delta_sec < 60
`).all();

db.close();

console.log(`Loaded ${rows.length} probe segments from stpt.db`);

// Compute probe segments with geometry
const probes = rows.map((row) => {
  const lat = parseFloat(row.lat), lng = parseFloat(row.lng);
  const prevLat = parseFloat(row.prev_lat), prevLng = parseFloat(row.prev_lng);
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (lat - prevLat) * toRad, dLng = (lng - prevLng) * toRad;
  const lat1 = prevLat * toRad, lat2 = lat * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const timeDelta = row.time_delta_sec;
  const speedKph = Math.max(0, (dist / timeDelta) * 3.6);
  return {
    route: row.route, vehicleId: row.id, speedKph,
    distanceMeters: dist, timeDeltaSeconds: timeDelta,
    delaySeconds: computeDelay(speedKph),
    serverTimestamp: row.server_timestamp,
    geometry: [[prevLng, prevLat], [lng, lat]],
  };
}).filter((p) => p.distanceMeters > 1);

console.log(`Computed ${probes.length} valid probe segments`);

// Match probes to signal approaches
const byKey = new Map();

for (const probe of probes) {
  for (const signal of signalPrograms) {
    const distToSignal = haversineMeters(
      { lng: probe.geometry[0][0], lat: probe.geometry[0][1] },
      signal.position,
    );
    if (distToSignal > APPROACH_RADIUS_METERS) continue;

    const probeHeading = bearingDegrees(
      { lng: probe.geometry[0][0], lat: probe.geometry[0][1] },
      { lng: probe.geometry[1][0], lat: probe.geometry[1][1] },
    );
    const headingDiff = angleDifferenceDegrees(probeHeading, signal.primaryHeadingDeg ?? 0);
    if (headingDiff > HEADING_TOLERANCE_DEG) continue;

    const hour = new Date(probe.serverTimestamp).getHours();
    const slot = classifySlot(hour);
    const key = `${signal.id}__${slot}`;

    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({
      signalId: signal.id,
      signalName: signal.name,
      signalPos: signal.position,
      headingDeg: signal.primaryHeadingDeg ?? 0,
      slot,
      speedKph: probe.speedKph,
      delaySeconds: probe.delaySeconds,
      headingDiff,
      distanceToSignal: distToSignal,
      vehicleId: probe.vehicleId,
      timestamp: probe.serverTimestamp,
    });
  }
}

const matchedSignals = new Set([...byKey.keys()].map((k) => k.split("__")[0]));
console.log(`Matched probes to ${matchedSignals.size} signal approaches over ${byKey.size} signal-slot combinations`);

// Build per-signal/slot statistics and distributions
const approaches = [];

for (const [key, group] of byKey.entries()) {
  if (group.length < 3) continue;
  const [signalId, slot] = key.split("__");
  const speeds = group.map((g) => g.speedKph);
  const delays = group.map((g) => g.delaySeconds);
  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
  const stdSpeed = Math.sqrt(speeds.reduce((a, s) => a + (s - avgSpeed) ** 2, 0) / speeds.length);
  const freeFlow = percentile(speeds, 85);
  const speedRatio = freeFlow > 0 ? avgSpeed / freeFlow : 1;
  const signal = signalPrograms.find((s) => s.id === signalId);

  const gamma = fitGamma(speeds);
  const lognormal = fitLognormal(speeds);
  const bestFit = gamma.ksPValue >= lognormal.ksPValue ? "gamma" : "lognormal";

  const vehicleSet = new Set(group.map((g) => g.vehicleId));
  const routeSet = new Set(group.map((g) => g.signalId));

  approaches.push({
    signalId,
    signalName: signal?.name ?? signalId,
    timeSlot: slot,
    sampleCount: group.length,
    nSpeed: speeds.length,
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
    gamma,
    lognormal,
    bestFit,
    byVehicleCount: vehicleSet.size,
    byRouteCount: routeSet.size,
  });
}

// City-wide speed ratio by time slot
const slotSpeedRatios = {};
for (const slot of TIME_SLOTS) {
  const allSpeeds = [];
  for (const [key, group] of byKey.entries()) {
    if (key.endsWith(`__${slot}`)) allSpeeds.push(...group.map((g) => g.speedKph));
  }
  if (allSpeeds.length > 0) {
    const ff = percentile(allSpeeds, 85);
    const avg = allSpeeds.reduce((a, b) => a + b, 0) / allSpeeds.length;
    slotSpeedRatios[slot] = { avgSpeedRatio: Math.round((avg / (ff + 0.001)) * 1000) / 1000, sampleCount: allSpeeds.length };
  } else {
    slotSpeedRatios[slot] = { avgSpeedRatio: 1, sampleCount: 0 };
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  scope: "STPT probe-to-intersection arrival model for Timișoara",
  totalSignals: signalPrograms.length,
  totalApproaches: signalPrograms.length * TIME_SLOTS.length,
  fittedApproaches: approaches.length,
  signalsWithData: matchedSignals.size,
  approaches,
  slotSpeedRatios,
};

const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync("data/derived", { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

console.log(`\n=== Arrival Model Summary ===`);
console.log(`Signals: ${output.totalSignals}, Approaches fitted: ${output.fittedApproaches}`);
console.log(`Signals with data: ${output.signalsWithData}`);
console.log(`\nCity-wide speed ratio by time slot:`);
for (const [slot, data] of Object.entries(output.slotSpeedRatios)) {
  console.log(`  ${slot}: ${data.avgSpeedRatio}x (${data.sampleCount} samples)`);
}
if (approaches.length > 0) {
  const sorted = [...approaches].sort((a, b) => a.speedRatio - b.speedRatio);
  console.log(`\nTop 5 slowest approaches:`);
  for (const app of sorted.slice(0, 5)) {
    console.log(`  ${app.signalId} [${app.timeSlot}]: ${app.speedRatio}x, ${app.sampleCount} samples, best fit: ${app.bestFit} (gamma ks=${app.gamma.ksPValue}, ln ${app.lognormal.ksPValue})`);
  }
  const heavy = approaches.filter((a) => a.regime === "heavy" || a.regime === "blocked");
  console.log(`\nHeavy/blocked approaches: ${heavy.length}`);
}
console.log(`\nOutput written to ${OUTPUT_PATH}`);

// Export sampling utility
export { sampleDistribution, fitGamma, fitLognormal, classifyRegime, TIME_SLOTS };
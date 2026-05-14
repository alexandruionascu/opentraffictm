import { writeFileSync, mkdirSync } from "fs";
import { queryAllProbeSegments } from "./stpt-probe";
import type { ProbeSegment } from "./stpt-probe";

/**
 * Route-level speed statistics from STPT live probes.
 * Produces per-route speed distributions and city-wide defaults
 * that can feed into simulation or congestion classification.
 */

export interface RouteCalibration {
  route: string;
  sampleCount: number;
  desiredSpeedKph: number;    // IDM desired speed (p85 of speed distribution)
  timeGapSeconds: number;    // IDM time gap (derived from gap ratio)
  maxAccelMps2: number;       // IDM max acceleration
  comfortDecelMps2: number;  // IDM comfortable deceleration
  avgSpeedKph: number;
  minSpeedKph: number;
  maxSpeedKph: number;
  avgDelaySeconds: number;
  quality: "high" | "medium" | "low";
}

export interface CalibrationOutput {
  generatedAt: string;
  method: "idm-calibration";
  description: string;
  defaults: {
    cityDesiredSpeedKph: number;
    cityTimeGapSeconds: number;
    cityMaxAccelMps2: number;
    cityComfortDecelMps2: number;
    cityAvgSpeedKph: number;
    cityMinSpeedKph: number;
    cityP50SpeedKph: number;
    cityP85SpeedKph: number;
    cityAvgDelaySeconds: number;
  };
  routes: RouteCalibration[];
  summary: {
    totalRoutes: number;
    highQualityRoutes: number;
    avgSpeedKph: number;
    cityAvgDelaySeconds: number;
  };
}

const NOMINAL_BUS_SPEED_KPH = 18;

function computeDelay(speedKph: number): number {
  if (speedKph <= 0) return 60;
  return Math.max(0, NOMINAL_BUS_SPEED_KPH - speedKph) * 3.6;
}

function minOf(arr: number[]): number { let m = arr[0]; for (const v of arr) if (v < m) m = v; return m; }
function maxOf(arr: number[]): number { let m = arr[0]; for (const v of arr) if (v > m) m = v; return m; }

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function estimateIDMParams(speeds: number[], distances: number[], timeDeltas: number[]): {
  desiredSpeedKph: number;
  timeGapSeconds: number;
  maxAccelMps2: number;
  comfortDecelMps2: number;
} {
  if (speeds.length < 10) {
    return { desiredSpeedKph: 34, timeGapSeconds: 17, maxAccelMps2: 4.5, comfortDecelMps2: 3.9 };
  }

  const p85Speed = percentile(speeds, 85);
  const desiredSpeedKph = Math.max(p85Speed, 20);

  const gaps: number[] = [];
  for (let i = 0; i < speeds.length; i++) {
    if (speeds[i] > 5 && timeDeltas[i] > 0) {
      const gapTime = distances[i] / Math.max(speeds[i] / 3.6, 1);
      gaps.push(gapTime);
    }
  }
  const avgGapTime = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 20;
  const timeGapSeconds = Math.min(Math.max(avgGapTime, 8), 30);

  const accels: number[] = [];
  for (let i = 1; i < speeds.length; i++) {
    if (timeDeltas[i] > 0) {
      const dv = speeds[i] - speeds[i - 1];
      const dt = timeDeltas[i];
      if (Math.abs(dv) < 20) {
        accels.push((dv / dt) * 3.6);
      }
    }
  }
  const maxAccelMps2 = accels.length > 0
    ? Math.min(Math.max(percentile(accels.filter(a => a > 0), 85), 1.5), 6)
    : 4.5;

  const decels = accels.filter(a => a < 0);
  const comfortDecelMps2 = decels.length > 0
    ? Math.min(Math.max(Math.abs(percentile(decels, 15)), 1.0), 6)
    : 3.9;

  return { desiredSpeedKph: Math.round(desiredSpeedKph * 10) / 10, timeGapSeconds: Math.round(timeGapSeconds * 10) / 10, maxAccelMps2: Math.round(maxAccelMps2 * 100) / 100, comfortDecelMps2: Math.round(comfortDecelMps2 * 100) / 100 };
}

export async function calibrateRoutes(): Promise<CalibrationOutput> {
  const allSegments = await queryAllProbeSegments();

  const byRoute = new Map<string, ProbeSegment[]>();
  for (const seg of allSegments) {
    const list = byRoute.get(seg.route) ?? [];
    list.push(seg);
    byRoute.set(seg.route, list);
  }

  const routes: RouteCalibration[] = [];

  for (const [route, segs] of byRoute.entries()) {
    const speeds = segs.map(s => s.speedKph);
    const distances = segs.map(s => s.distanceMeters);
    const timeDeltas = segs.map(s => s.timeDeltaSeconds);
    const delays = segs.map(s => s.delaySeconds);

    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const variance = speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(speeds.length - 1, 1);
    const stdDev = Math.sqrt(variance);
    const quality: RouteCalibration["quality"] = segs.length >= 5000 && stdDev < 12 ? "high" : segs.length >= 500 && stdDev < 20 ? "medium" : "low";

    const idm = estimateIDMParams(speeds, distances, timeDeltas);

    routes.push({
      route,
      sampleCount: segs.length,
      desiredSpeedKph: idm.desiredSpeedKph,
      timeGapSeconds: idm.timeGapSeconds,
      maxAccelMps2: idm.maxAccelMps2,
      comfortDecelMps2: idm.comfortDecelMps2,
      avgSpeedKph: Math.round(mean * 10) / 10,
      minSpeedKph: minOf(speeds),
      maxSpeedKph: maxOf(speeds),
      avgDelaySeconds: Math.round(delays.reduce((a, b) => a + b, 0) / Math.max(delays.length, 1) * 10) / 10,
      quality,
    });
  }

  const highQuality = routes.filter(r => r.quality === "high");
  const allSpeeds = routes.flatMap(r => {
    const arr: number[] = [];
    for (let i = 0; i < Math.min(r.sampleCount, 1000); i++) arr.push(r.avgSpeedKph);
    return arr;
  });

  const hqSpeeds = highQuality.flatMap(r => {
    const arr: number[] = [];
    for (let i = 0; i < Math.min(r.sampleCount, 1000); i++) arr.push(r.avgSpeedKph);
    return arr;
  });

  const defaults = highQuality.length >= 5
    ? {
        cityDesiredSpeedKph: Math.round((highQuality.reduce((a, r) => a + r.desiredSpeedKph, 0) / highQuality.length) * 10) / 10,
        cityTimeGapSeconds: Math.round((highQuality.reduce((a, r) => a + r.timeGapSeconds, 0) / highQuality.length) * 10) / 10,
        cityMaxAccelMps2: Math.round((highQuality.reduce((a, r) => a + r.maxAccelMps2, 0) / highQuality.length) * 100) / 100,
        cityComfortDecelMps2: Math.round((highQuality.reduce((a, r) => a + r.comfortDecelMps2, 0) / highQuality.length) * 100) / 100,
        cityAvgSpeedKph: Math.round((hqSpeeds.reduce((a, b) => a + b, 0) / Math.max(hqSpeeds.length, 1)) * 10) / 10,
        cityMinSpeedKph: Math.min(...hqSpeeds),
        cityP50SpeedKph: Math.round(percentile(hqSpeeds, 50) * 10) / 10,
        cityP85SpeedKph: Math.round(percentile(hqSpeeds, 85) * 10) / 10,
        cityAvgDelaySeconds: Math.round((highQuality.reduce((a, r) => a + r.avgDelaySeconds, 0) / highQuality.length) * 10) / 10,
      }
    : { cityDesiredSpeedKph: 34, cityTimeGapSeconds: 17, cityMaxAccelMps2: 4.5, cityComfortDecelMps2: 3.9, cityAvgSpeedKph: 22, cityMinSpeedKph: 3, cityP50SpeedKph: 20, cityP85SpeedKph: 35, cityAvgDelaySeconds: 30 };

  return {
    generatedAt: new Date().toISOString(),
    method: "idm-calibration",
    description: "IDM car-following parameter calibration from STPT historical probe segments",
    defaults,
    routes: routes.sort((a, b) => b.sampleCount - a.sampleCount),
    summary: {
      totalRoutes: routes.length,
      highQualityRoutes: highQuality.length,
      avgSpeedKph: defaults.cityAvgSpeedKph,
      cityAvgDelaySeconds: defaults.cityAvgDelaySeconds,
    },
  };
}

export async function main() {
  mkdirSync("data/derived", { recursive: true });

  const result = await calibrateRoutes();
  writeFileSync("data/derived/calibration-results.json", JSON.stringify(result, null, 2));

  const header = "route,sampleCount,desiredSpeedKph,timeGapSeconds,maxAccelMps2,comfortDecelMps2,avgSpeedKph,minSpeedKph,maxSpeedKph,avgDelaySeconds,quality";
  const rows = result.routes.map(r =>
    `${r.route},${r.sampleCount},${r.desiredSpeedKph},${r.timeGapSeconds},${r.maxAccelMps2},${r.comfortDecelMps2},${r.avgSpeedKph},${r.minSpeedKph},${r.maxSpeedKph},${r.avgDelaySeconds},${r.quality}`
  );
  writeFileSync("data/derived/calibration-results.csv", [header, ...rows].join("\n"));

  console.log(`\n=== IDM Calibration from STPT Historical Data ===`);
  console.log(`Method: ${result.method}`);
  console.log(`Routes: ${result.summary.totalRoutes} (${result.summary.highQualityRoutes} high-quality)`);
  console.log(`City-wide IDM defaults: desiredSpeed=${result.defaults.cityDesiredSpeedKph} km/h, timeGap=${result.defaults.cityTimeGapSeconds} s, maxAccel=${result.defaults.cityMaxAccelMps2} m/s², comfortDecel=${result.defaults.cityComfortDecelMps2} m/s²`);
  console.log(`City-wide speed: avg=${result.defaults.cityAvgSpeedKph} km/h, p50=${result.defaults.cityP50SpeedKph}, p85=${result.defaults.cityP85SpeedKph} km/h`);
  console.log(`\nPer-route IDM parameters:`);
  for (const r of result.routes.slice(0, 20)) {
    console.log(`  ${r.route}: desiredSpeed=${r.desiredSpeedKph} km/h, timeGap=${r.timeGapSeconds} s, maxAccel=${r.maxAccelMps2}, comfortDecel=${r.comfortDecelMps2} | avg=${r.avgSpeedKph} km/h, delay=${r.avgDelaySeconds}s, quality=${r.quality} (${r.sampleCount} segments)`);
  }
}

main().catch(console.error);
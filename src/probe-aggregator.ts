import { writeFileSync, mkdirSync } from "fs";
import { queryAllProbeSegments } from "./stpt-probe";
import type { ProbeSegment } from "./stpt-probe";

export interface LiveVehicle {
  id: string;
  route: string;
  lat: number;
  lng: number;
  bearing?: number;
  speed?: number;
  directionId?: string;
  headsign?: string;
  stop?: string;
  timestamp?: number;
}

export interface LiveProbeSnapshot {
  collectedAt: string;
  vehicleCount: number;
  routeCount: number;
  vehicles: LiveVehicle[];
}

export interface ProbeWindow {
  windowStart: string;
  windowEnd: string;
  segmentId: string;
  route: string;
  sampleCount: number;
  avgSpeedKph: number;
  minSpeedKph: number;
  maxSpeedKph: number;
  avgDelaySeconds: number;
  totalDistanceMeters: number;
  geometry: [number, number][];
}

export interface ProbeAggregationResult {
  generatedAt: string;
  windowSeconds: number;
  scope: string;
  counts: {
    totalWindows: number;
    totalVehicles: number;
    routesWithData: number;
    totalSegments: number;
  };
  byRoute: ProbeWindow[];
  cityWide: {
    totalSamples: number;
    avgSpeedKph: number;
    avgDelaySeconds: number;
    speedHistogram: { bin: string; count: number }[];
    delayHistogram: { bin: string; count: number }[];
  };
  byTimeSlot: Record<string, {
    sampleCount: number;
    avgSpeedKph: number;
    avgDelaySeconds: number;
    routeCount: number;
  }>;
}

const NOMINAL_BUS_SPEED_KPH = 18;

function computeDelay(speedKph: number): number {
  if (speedKph <= 0) return 60;
  return Math.max(0, NOMINAL_BUS_SPEED_KPH - speedKph) * 3.6;
}

function classifySlot(hour: number): string {
  if (hour >= 7  && hour < 9)  return "morning-rush";
  if (hour >= 10 && hour < 12) return "mid-morning";
  if (hour >= 12 && hour < 14) return "midday";
  if (hour >= 17 && hour < 19) return "afternoon-rush";
  if (hour >= 19 && hour < 21) return "evening";
  return "night";
}

function buildHistogram(values: number[], binSize: number): { bin: string; count: number }[] {
  if (values.length === 0) return [];
  let min = values[0], max = values[0];
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  const bins: Record<string, number> = {};
  for (let v = Math.floor(min / binSize) * binSize; v <= max + binSize; v += binSize) {
    bins[`${v}-${v + binSize}`] = 0;
  }
  for (const v of values) {
    const key = `${Math.floor(v / binSize) * binSize}-${Math.floor(v / binSize) * binSize + binSize}`;
    bins[key] = (bins[key] ?? 0) + 1;
  }
  return Object.entries(bins).map(([bin, count]) => ({ bin, count }));
}

export async function aggregateProbes(): Promise<ProbeAggregationResult> {
  const allSegments = await queryAllProbeSegments();

  const byRouteMap = new Map<string, ProbeSegment[]>();
  for (const seg of allSegments) {
    const list = byRouteMap.get(seg.route) ?? [];
    list.push(seg);
    byRouteMap.set(seg.route, list);
  }

  const byRoute: ProbeWindow[] = [];
  const speedsAll: number[] = [];
  const delaysAll: number[] = [];
  const bySlot: Record<string, { speeds: number[]; delays: number[]; routes: Set<string> }> = {};

  for (const [route, segs] of byRouteMap.entries()) {
    const speeds = segs.map(s => s.speedKph);
    const delays = segs.map(s => s.delaySeconds);
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;

    const firstGeom = segs[0].geometry[0];
    const lastGeom = segs[segs.length - 1].geometry[segs[segs.length - 1].geometry.length - 1];

    byRoute.push({
      windowStart: new Date(segs[0].serverTimestamp).toISOString(),
      windowEnd: new Date(segs[segs.length - 1].serverTimestamp).toISOString(),
      segmentId: route,
      route,
      sampleCount: segs.length,
      avgSpeedKph: Math.round(avgSpeed * 10) / 10,
      minSpeedKph: Math.min(...speeds),
      maxSpeedKph: Math.max(...speeds),
      avgDelaySeconds: Math.round(avgDelay * 10) / 10,
      totalDistanceMeters: Math.round(segs.reduce((a, s) => a + s.distanceMeters, 0)),
      geometry: [firstGeom, lastGeom],
    });

    speedsAll.push(...speeds);
    delaysAll.push(...delays);

    const hour = new Date(segs[0].serverTimestamp).getHours();
    const slot = classifySlot(hour);
    if (!bySlot[slot]) bySlot[slot] = { speeds: [], delays: [], routes: new Set() };
    bySlot[slot].speeds.push(...speeds);
    bySlot[slot].delays.push(...delays);
    bySlot[slot].routes.add(route);
  }

  const routesWithData = byRouteMap.size;
  const uniqueVehicles = new Set(allSegments.map(s => s.vehicleId)).size;

  return {
    generatedAt: new Date().toISOString(),
    windowSeconds: 0,
    scope: "Timisoara STPT historical probes (stpt.db)",
    counts: {
      totalWindows: byRoute.length,
      totalVehicles: uniqueVehicles,
      routesWithData,
      totalSegments: allSegments.length,
    },
    byRoute,
    cityWide: {
      totalSamples: speedsAll.length,
      avgSpeedKph: Math.round((speedsAll.reduce((a, b) => a + b, 0) / Math.max(speedsAll.length, 1)) * 10) / 10,
      avgDelaySeconds: Math.round((delaysAll.reduce((a, b) => a + b, 0) / Math.max(delaysAll.length, 1)) * 10) / 10,
      speedHistogram: buildHistogram(speedsAll, 5),
      delayHistogram: buildHistogram(delaysAll, 10),
    },
    byTimeSlot: Object.fromEntries(
      Object.entries(bySlot).map(([slot, data]) => [
        slot,
        {
          sampleCount: data.speeds.length,
          avgSpeedKph: Math.round((data.speeds.reduce((a, b) => a + b, 0) / Math.max(data.speeds.length, 1)) * 10) / 10,
          avgDelaySeconds: Math.round((data.delays.reduce((a, b) => a + b, 0) / Math.max(data.delays.length, 1)) * 10) / 10,
          routeCount: data.routes.size,
        },
      ])
    ),
  };
}

export async function main() {
  mkdirSync("data/derived", { recursive: true });

  const result = await aggregateProbes();
  writeFileSync("data/derived/probe-aggregation.json", JSON.stringify(result, null, 2));

  console.log(`\n=== Probe Aggregation Summary ===`);
  console.log(`Segments: ${result.counts.totalSegments}, Vehicles: ${result.counts.totalVehicles}, Routes: ${result.counts.routesWithData}`);
  console.log(`City-wide avg speed: ${result.cityWide.avgSpeedKph} km/h, avg delay: ${result.cityWide.avgDelaySeconds} s`);
  console.log(`\nBy time slot:`);
  for (const [slot, stats] of Object.entries(result.byTimeSlot)) {
    console.log(`  ${slot}: ${stats.sampleCount} samples, ${stats.avgSpeedKph} km/h, ${stats.avgDelaySeconds} s delay, ${stats.routeCount} routes`);
  }

  console.log(`\nTop 10 slowest routes (by avg speed):`);
  const sorted = [...result.byRoute].sort((a, b) => a.avgSpeedKph - b.avgSpeedKph);
  for (const w of sorted.slice(0, 10)) {
    console.log(`  ${w.route}: ${w.avgSpeedKph} km/h, delay ${w.avgDelaySeconds} s, ${w.sampleCount} segments`);
  }
}

main().catch(console.error);
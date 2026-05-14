import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { aggregateProbes } from "./probe-aggregator";
import { profileTomTom } from "./tomtom-profiler";

export type CongestionRegime = "free" | "light" | "heavy" | "blocked";

export interface CongestionAnomaly {
  segmentId: string;
  source: "probe" | "tomtom";
  description: string;
  probeSpeedKph: number | null;
  tomtomSpeedKph: number | null;
  disagreement: number; // absolute speed ratio difference
}

export interface CongestionRegimeEntry {
  route: string;
  regime: CongestionRegime;
  avgSpeedKph: number;
  speedRatio: number | null; // vs free-flow (from TomTom if available)
  confidence: number;
  anomaly: boolean;
  source: "probe" | "tomtom" | "both";
  geometry: [number, number][];
}

export interface CongestionClassifierOutput {
  generatedAt: string;
  description: string;
  records: CongestionRegimeEntry[];
  anomalies: CongestionAnomaly[];
  byRegime: Record<CongestionRegime, number>;
  summary: {
    totalSegments: number;
    anomalousSegments: number;
    dominantRegime: CongestionRegime;
    routesByRegime: Record<CongestionRegime, string[]>;
    cityCongestionIndex: number; // 0=fully free, 1=fully blocked
  };
}

const FREE_FLOW_KPH = 50; // default free-flow assumption for probe-only segments

function classifyRegime(speedRatio: number): CongestionRegime {
  if (speedRatio >= 0.85) return "free";
  if (speedRatio >= 0.65) return "light";
  if (speedRatio >= 0.40) return "heavy";
  return "blocked";
}

function speedRatioFromProbe(avgSpeedKph: number): number {
  return avgSpeedKph / FREE_FLOW_KPH;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function classifyCongestion(): Promise<CongestionClassifierOutput> {
  const probeResult = await aggregateProbes();
  const tomtomResult = await profileTomTom();

  const anomalies: CongestionAnomaly[] = [];
  const records: CongestionRegimeEntry[] = [];

  // Build TomTom lookup by lat/lng
  const tomtomByPoint = new Map<string, {
    speedKph: number;
    freeFlowKph: number;
    speedRatio: number;
  }>();
  for (const seg of tomtomResult.segments) {
    const key = `${seg.lat.toFixed(5)},${seg.lng.toFixed(5)}`;
    // Average across available slots for a given point
    const ratios = Object.values(seg.bySlot).map(s => s.speedRatio);
    const speeds = Object.values(seg.bySlot).map(s => s.currentSpeedKph);
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / Math.max(ratios.length, 1);
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / Math.max(speeds.length, 1);
    tomtomByPoint.set(key, { speedKph: avgSpeed, freeFlowKph: seg.freeFlowSpeedKph, speedRatio: avgRatio });
  }

  // Classify probe routes
  for (const window of probeResult.byRoute) {
    const ratio = speedRatioFromProbe(window.avgSpeedKph);
    const regime = classifyRegime(ratio);

    // Find nearest TomTom segment
    let nearestTomtom: { speedKph: number; freeFlowKph: number; speedRatio: number } | null = null;
    let minDist = Infinity;
    for (const [key, tt] of tomtomByPoint) {
      const [lat, lng] = key.split(",").map(Number);
      const dist = haversineDistance(window.geometry[0][1], window.geometry[0][0], lat, lng);
      if (dist < minDist) { minDist = dist; nearestTomtom = tt; }
    }

    const hasTomtom = nearestTomtom !== null && minDist < 500;
    let anomaly = false;
    let source: CongestionRegimeEntry["source"] = "probe";

    if (hasTomtom && nearestTomtom) {
      const tomtomRatio = nearestTomtom.speedRatio;
      const disagreement = Math.abs(ratio - tomtomRatio);
      if (disagreement > 0.2) {
        anomaly = true;
        anomalies.push({
          segmentId: window.route,
          source: "both",
          description: `Probe ratio ${ratio.toFixed(2)} vs TomTom ratio ${tomtomRatio.toFixed(2)} (disagree by ${(disagreement * 100).toFixed(0)}%)`,
          probeSpeedKph: window.avgSpeedKph,
          tomtomSpeedKph: nearestTomtom.speedKph,
          disagreement,
        });
      }
      source = "both";
    }

    records.push({
      route: window.route,
      regime,
      avgSpeedKph: window.avgSpeedKph,
      speedRatio: hasTomtom && nearestTomtom ? Math.round(nearestTomtom.speedRatio * 1000) / 1000 : null,
      confidence: hasTomtom ? 0.85 : 0.65,
      anomaly,
      source,
      geometry: window.geometry,
    });
  }

  // Add TomTom-only segments that don't have probe coverage
  for (const [key, tt] of tomtomByPoint) {
    const [lat, lng] = key.split(",").map(Number);
    const alreadyCovered = records.some(r => {
      const dist = haversineDistance(r.geometry[0][1], r.geometry[0][0], lat, lng);
      return dist < 100;
    });
    if (alreadyCovered) continue;

    const regime = classifyRegime(tt.speedRatio);
    records.push({
      route: `tomtom-${key}`,
      regime,
      avgSpeedKph: tt.speedKph,
      speedRatio: Math.round(tt.speedRatio * 1000) / 1000,
      confidence: 0.8,
      anomaly: false,
      source: "tomtom",
      geometry: [[lng, lat]] as [number, number][],
    });
  }

  const byRegime: Record<CongestionRegime, number> = { free: 0, light: 0, heavy: 0, blocked: 0 };
  const routesByRegime: Record<CongestionRegime, string[]> = { free: [], light: [], heavy: [], blocked: [] };
  let anomalousSegments = 0;

  for (const rec of records) {
    byRegime[rec.regime]++;
    routesByRegime[rec.regime].push(rec.route);
    if (rec.anomaly) anomalousSegments++;
  }

  const dominantRegime = (Object.entries(byRegime).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "free") as CongestionRegime;
  const total = records.length;
  const cityCongestionIndex = total > 0
    ? Math.round(((byRegime.heavy + byRegime.blocked * 2) / Math.max(total, 1)) * 100) / 100
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    description: "Congestion regime classification combining STPT probe data and TomTom flow data",
    records,
    anomalies,
    byRegime,
    summary: {
      totalSegments: total,
      anomalousSegments,
      dominantRegime,
      routesByRegime,
      cityCongestionIndex,
    },
  };
}

export async function main() {
  mkdirSync("data/derived", { recursive: true });

  const result = await classifyCongestion();
  writeFileSync("data/derived/congestion-regimes.json", JSON.stringify(result, null, 2));

  // Summary CSV
  const header = "route,regime,avgSpeedKph,speedRatio,confidence,anomaly,source";
  const rows = result.records.map(r =>
    `${r.route},${r.regime},${r.avgSpeedKph},${r.speedRatio ?? ""},${r.confidence},${r.anomaly},${r.source}`
  );
  writeFileSync("data/derived/congestion-summary.csv", [header, ...rows].join("\n"));

  console.log(`\n=== Congestion Regime Classification ===`);
  console.log(`Total segments: ${result.summary.totalSegments}, anomalous: ${result.summary.anomalousSegments}`);
  console.log(`Dominant regime: ${result.summary.dominantRegime}, city congestion index: ${result.summary.cityCongestionIndex}`);
  console.log(`\nRegime breakdown:`);
  for (const [regime, count] of Object.entries(result.byRegime)) {
    const pct = result.summary.totalSegments > 0 ? Math.round(count / result.summary.totalSegments * 100) : 0;
    console.log(`  ${regime}: ${count} (${pct}%)`);
  }
  if (result.anomalies.length > 0) {
    console.log(`\nAnomalies (probe vs TomTom disagreement > 20%):`);
    for (const a of result.anomalies) {
      console.log(`  ${a.segmentId}: ${a.description}`);
    }
  }
}

main().catch(console.error);
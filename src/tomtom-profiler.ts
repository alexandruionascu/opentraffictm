import { readFileSync, writeFileSync, mkdirSync } from "fs";

export interface TomTomFlowRecord {
  pointId: string;
  collectedAt: string;
  slotHour: number;
  lat: number;
  lng: number;
  currentSpeedKph: number;
  freeFlowSpeedKph: number;
  currentTravelTimeSec: number;
  freeFlowTravelTimeSec: number;
  speedRatio: number;
  delaySeconds: number;
  congestionLevel: string;
  confidence: number;
}

export interface TomTomTimeSlot {
  label: string;
  hour: number;
  minute: number;
  date: string;
}

export interface TomTomFlowData {
  provider: string;
  collectedAt: string;
  date: string;
  timeSlots: TomTomTimeSlot[];
  bbox: [number, number, number, number];
  pointCount: number;
  totalTransactions: number;
  flowRecordCount: number;
  incidentCount: number;
  flow: TomTomFlowRecord[];
}

export type CongestionRegime = "free" | "light" | "heavy" | "blocked";

export interface SegmentProfile {
  pointId: string;
  lat: number;
  lng: number;
  freeFlowSpeedKph: number;
  bySlot: Record<string, {
    currentSpeedKph: number;
    travelTimeSeconds: number;
    freeFlowTravelTimeSeconds: number;
    speedRatio: number;
    delaySeconds: number;
    regime: CongestionRegime;
    confidence: number;
  }>;
  overall: {
    avgSpeedRatio: number;
    avgDelaySeconds: number;
    dominantRegime: CongestionRegime;
    regimeCounts: Record<CongestionRegime, number>;
  };
}

export interface TomTomProfilerOutput {
  generatedAt: string;
  dataSource: string;
  recordCount: number;
  slotCount: number;
  segments: SegmentProfile[];
  summary: {
    slotLabels: string[];
    cityAvgSpeedRatioBySlot: Record<string, number>;
    cityAvgDelayBySlot: Record<string, number>;
    hotspotCount: { heavy: number; blocked: number };
    speedProfileMatrix: { slot: string; avgSpeedKph: number; avgFreeFlowKph: number; avgRatio: number; avgDelay: number }[];
  };
}

const REGIME_THRESHOLDS = { free: 0.85, light: 0.65, heavy: 0.40, blocked: 0.25 };

function classifyRegime(speedRatio: number): CongestionRegime {
  if (speedRatio >= REGIME_THRESHOLDS.free) return "free";
  if (speedRatio >= REGIME_THRESHOLDS.light) return "light";
  if (speedRatio >= REGIME_THRESHOLDS.blocked) return "heavy";
  return "blocked";
}

function getSlotLabel(slotHour: number): string {
  if (slotHour === 7 || slotHour === 8) return "morning-rush";
  if (slotHour === 10) return "mid-morning";
  if (slotHour === 12) return "midday";
  if (slotHour === 17 || slotHour === 18) return "afternoon-rush";
  if (slotHour === 19 || slotHour === 20) return "evening";
  if (slotHour === 22) return "night";
  return "unknown";
}

export async function profileTomTom(): Promise<TomTomProfilerOutput> {
  const raw = readFileSync("data/traffic-flow/tomtom-latest.json", "utf-8");
  const data: TomTomFlowData = JSON.parse(raw);

  if (!data.flow || data.flow.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      dataSource: "data/traffic-flow/tomtom-latest.json",
      recordCount: 0,
      slotCount: 0,
      segments: [],
      summary: { slotLabels: [], cityAvgSpeedRatioBySlot: {}, cityAvgDelayBySlot: {}, hotspotCount: { heavy: 0, blocked: 0 }, speedProfileMatrix: [] },
    };
  }

  // Group records by point (lat/lng rounded)
  const byPoint = new Map<string, TomTomFlowRecord[]>();
  for (const rec of data.flow) {
    const key = `${rec.lat.toFixed(5)},${rec.lng.toFixed(5)}`;
    const list = byPoint.get(key) ?? [];
    list.push(rec);
    byPoint.set(key, list);
  }

  const segments: SegmentProfile[] = [];
  const citySpeedRatioBySlot: Record<string, number[]> = {};
  const cityDelayBySlot: Record<string, number[]> = {};

  for (const [key, recs] of byPoint.entries()) {
    const [lat, lng] = key.split(",").map(Number);
    const first = recs[0];
    const freeFlow = first.freeFlowSpeedKph ?? first.currentSpeedKph * 1.2;
    const bySlot: SegmentProfile["bySlot"] = {};

    const regimeCounts: Record<CongestionRegime, number> = { free: 0, light: 0, heavy: 0, blocked: 0 };
    const speedRatios: number[] = [];
    const delays: number[] = [];

    for (const rec of recs) {
      const slotLabel = getSlotLabel(rec.slotHour);
      if (slotLabel === "unknown") continue;

      const ratio = rec.currentSpeedKph / Math.max(freeFlow, 1);
      const delay = rec.delaySeconds ?? Math.max(0, rec.currentTravelTimeSec - rec.freeFlowTravelTimeSec);
      const regime = classifyRegime(rec.speedRatio ?? ratio);

      if (!citySpeedRatioBySlot[slotLabel]) citySpeedRatioBySlot[slotLabel] = [];
      if (!cityDelayBySlot[slotLabel]) cityDelayBySlot[slotLabel] = [];
      citySpeedRatioBySlot[slotLabel].push(ratio);
      cityDelayBySlot[slotLabel].push(Math.max(0, delay));

      if (!bySlot[slotLabel]) {
        const slotData = {
          currentSpeedKph: rec.currentSpeedKph,
          travelTimeSeconds: rec.currentTravelTimeSec,
          freeFlowTravelTimeSeconds: rec.freeFlowTravelTimeSec,
          speedRatio: Math.round((rec.speedRatio ?? ratio) * 1000) / 1000,
          delaySeconds: Math.round(Math.max(0, delay)),
          regime,
          confidence: rec.confidence ?? 0.8,
        };
        bySlot[slotLabel] = slotData;
      }

      regimeCounts[regime]++;
      speedRatios.push(ratio);
      delays.push(Math.max(0, delay));
    }

    const avgRatio = speedRatios.reduce((a, b) => a + b, 0) / Math.max(speedRatios.length, 1);
    const avgDelay = delays.reduce((a, b) => a + b, 0) / Math.max(delays.length, 1);
    const dominantRegime = (Object.entries(regimeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "free") as CongestionRegime;

    segments.push({
      pointId: first.pointId,
      lat,
      lng,
      freeFlowSpeedKph: freeFlow,
      bySlot,
      overall: {
        avgSpeedRatio: Math.round(avgRatio * 1000) / 1000,
        avgDelaySeconds: Math.round(avgDelay),
        dominantRegime,
        regimeCounts,
      },
    });
  }

  const slotLabels = Object.keys(citySpeedRatioBySlot);
  const speedMatrix = slotLabels.map(slot => {
    const ratios = citySpeedRatioBySlot[slot];
    const dls = cityDelayBySlot[slot];
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / Math.max(ratios.length, 1);
    const avgDelay = dls.reduce((a, b) => a + b, 0) / Math.max(dls.length, 1);
    return {
      slot,
      avgSpeedKph: Math.round((ratios.reduce((a, b) => a + b, 0) / Math.max(ratios.length, 1)) * freeFlowRef(segments) * 10) / 10,
      avgFreeFlowKph: Math.round(freeFlowRef(segments) * 10) / 10,
      avgRatio: Math.round(avgRatio * 1000) / 1000,
      avgDelay: Math.round(avgDelay),
    };
  });

  const heavyCount = segments.filter(s => s.overall.dominantRegime === "heavy").length;
  const blockedCount = segments.filter(s => s.overall.dominantRegime === "blocked").length;

  return {
    generatedAt: new Date().toISOString(),
    dataSource: "data/traffic-flow/tomtom-latest.json",
    recordCount: data.flowRecordCount,
    slotCount: data.timeSlots.length,
    segments,
    summary: {
      slotLabels,
      cityAvgSpeedRatioBySlot: Object.fromEntries(
        slotLabels.map(slot => {
          const vals = citySpeedRatioBySlot[slot];
          const avg = vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1);
          return [slot, Math.round(avg * 1000) / 1000];
        })
      ),
      cityAvgDelayBySlot: Object.fromEntries(
        slotLabels.map(slot => {
          const vals = cityDelayBySlot[slot];
          const avg = vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1);
          return [slot, Math.round(avg)];
        })
      ),
      hotspotCount: { heavy: heavyCount, blocked: blockedCount },
      speedProfileMatrix: speedMatrix,
    },
  };
}

function freeFlowRef(segments: SegmentProfile[]): number {
  if (segments.length === 0) return 50;
  const refs = segments.map(s => s.freeFlowSpeedKph).filter(v => v > 0);
  return refs.reduce((a, b) => a + b, 0) / Math.max(refs.length, 1);
}

export async function main() {
  mkdirSync("data/derived", { recursive: true });

  const result = await profileTomTom();
  writeFileSync("data/derived/tomtom-corridor-profiles.json", JSON.stringify(result, null, 2));

  // Speed profiles CSV: slot, pointId, lat, lng, currentSpeedKph, freeFlowSpeedKph, speedRatio, delaySeconds, regime
  const speedHeader = "slot,pointId,lat,lng,currentSpeedKph,freeFlowSpeedKph,speedRatio,delaySeconds,regime";
  const speedRows: string[] = [];
  for (const seg of result.segments) {
    for (const [slot, stats] of Object.entries(seg.bySlot)) {
      speedRows.push(`${slot},${seg.pointId},${seg.lat},${seg.lng},${stats.currentSpeedKph},${seg.freeFlowSpeedKph},${stats.speedRatio},${stats.delaySeconds},${stats.regime}`);
    }
  }
  writeFileSync("data/derived/speed-profiles.csv", [speedHeader, ...speedRows].join("\n"));

  console.log(`\n=== TomTom Corridor Profiling ===`);
  console.log(`Records: ${result.recordCount}, Segments: ${result.segments.length}`);
  console.log(`Time slots: ${result.summary.slotLabels.join(", ")}`);
  console.log(`\nCity-wide avg speed ratio by slot:`);
  for (const [slot, ratio] of Object.entries(result.summary.cityAvgSpeedRatioBySlot)) {
    console.log(`  ${slot}: ${ratio}x (avg delay ${result.summary.cityAvgDelayBySlot[slot]} s)`);
  }
  console.log(`\nCongestion hotspots: ${result.summary.hotspotCount.heavy} heavy, ${result.summary.hotspotCount.blocked} blocked`);

  console.log(`\nSpeed profile matrix:`);
  for (const row of result.summary.speedProfileMatrix) {
    console.log(`  ${row.slot}: ${row.avgSpeedKph}/${row.avgFreeFlowKph} km/h (ratio ${row.avgRatio}, delay ${row.avgDelay}s)`);
  }
}

main().catch(console.error);

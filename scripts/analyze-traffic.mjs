import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const derivedDir = "data/derived";
await mkdir(derivedDir, { recursive: true });

console.log("=== Traffic Analysis Pipeline ===\n");

// Phase 1: Probe Aggregation
console.log("[1/4] Aggregating STPT probe data...");
const { aggregateProbes } = await import("../src/probe-aggregator.ts");
const probeResult = await aggregateProbes();
await writeFile(join(derivedDir, "probe-aggregation.json"), JSON.stringify(probeResult, null, 2));
console.log(`  → ${probeResult.counts.totalSegments} segments, ${probeResult.counts.routesWithData} routes`);
console.log(`  → city-wide avg: ${probeResult.cityWide.avgSpeedKph} km/h, ${probeResult.cityWide.avgDelaySeconds} s delay`);

// Phase 2: Car-Following Calibration
console.log("\n[2/4] Calibrating car-following parameters...");
const { calibrateRoutes } = await import("../src/calibration.ts");
const calibResult = await calibrateRoutes();
await writeFile(join(derivedDir, "calibration-results.json"), JSON.stringify(calibResult, null, 2));
const calibCsvHeader = "route,sampleCount,avgSpeedKph,minSpeedKph,maxSpeedKph,stdDevKph,avgDelaySeconds,p50SpeedKph,p85SpeedKph,quality";
const calibCsvRows = calibResult.routes.map(r =>
  `${r.route},${r.sampleCount},${r.avgSpeedKph},${r.minSpeedKph},${r.maxSpeedKph},${r.stdDevKph},${r.avgDelaySeconds},${r.p50SpeedKph},${r.p85SpeedKph},${r.quality}`
);
await writeFile(join(derivedDir, "calibration-results.csv"), [calibCsvHeader, ...calibCsvRows].join("\n"));
console.log(`  → ${calibResult.summary.totalRoutes} routes (${calibResult.summary.highQualityRoutes} high-quality)`);
console.log(`  → city-wide defaults: avg=${calibResult.defaults.cityAvgSpeedKph} km/h, p50=${calibResult.defaults.cityP50SpeedKph}, p85=${calibResult.defaults.cityP85SpeedKph} km/h`);

// Phase 3: TomTom Corridor Profiling
console.log("\n[3/4] Profiling TomTom corridor data...");
const { profileTomTom } = await import("../src/tomtom-profiler.ts");
const tomtomResult = await profileTomTom();
await writeFile(join(derivedDir, "tomtom-corridor-profiles.json"), JSON.stringify(tomtomResult, null, 2));
const speedHeader = "slot,pointId,lat,lng,currentSpeedKph,freeFlowSpeedKph,speedRatio,delaySeconds,regime";
const speedRows = [];
for (const seg of tomtomResult.segments) {
  for (const [slot, stats] of Object.entries(seg.bySlot)) {
    speedRows.push(`${slot},${seg.pointId},${seg.lat},${seg.lng},${stats.currentSpeedKph},${seg.freeFlowSpeedKph},${stats.speedRatio},${stats.delaySeconds},${stats.regime}`);
  }
}
await writeFile(join(derivedDir, "speed-profiles.csv"), [speedHeader, ...speedRows].join("\n"));
console.log(`  → ${tomtomResult.recordCount} records, ${tomtomResult.segments.length} segments`);
console.log(`  → hotspots: ${tomtomResult.summary.hotspotCount.heavy} heavy, ${tomtomResult.summary.hotspotCount.blocked} blocked`);

// Phase 4: Congestion Classification
console.log("\n[4/4] Classifying congestion regimes...");
const { classifyCongestion } = await import("../src/congestion-classifier.ts");
const congestionResult = await classifyCongestion();
await writeFile(join(derivedDir, "congestion-regimes.json"), JSON.stringify(congestionResult, null, 2));
const congCsvHeader = "route,regime,avgSpeedKph,speedRatio,confidence,anomaly,source";
const congCsvRows = congestionResult.records.map(r =>
  `${r.route},${r.regime},${r.avgSpeedKph},${r.speedRatio ?? ""},${r.confidence},${r.anomaly},${r.source}`
);
await writeFile(join(derivedDir, "congestion-summary.csv"), [congCsvHeader, ...congCsvRows].join("\n"));
console.log(`  → ${congestionResult.summary.totalSegments} segments, ${congestionResult.summary.anomalousSegments} anomalies`);
console.log(`  → dominant: ${congestionResult.summary.dominantRegime}, congestion index: ${congestionResult.summary.cityCongestionIndex}`);

// Human-readable summary
console.log("\n=== Final Summary ===");
console.log(`\nCongestion regime breakdown:`);
for (const [regime, count] of Object.entries(congestionResult.byRegime)) {
  const pct = congestionResult.summary.totalSegments > 0
    ? Math.round(count / congestionResult.summary.totalSegments * 100) : 0;
  console.log(`  ${regime}: ${count} (${pct}%)`);
}

if (congestionResult.anomalies.length > 0) {
  console.log(`\nAnomalies (probe vs TomTom disagreement > 20%):`);
  for (const a of congestionResult.anomalies) {
    console.log(`  ${a.segmentId}: ${a.description}`);
  }
}

console.log(`\nTop 10 slowest routes (probe data):`);
const slowest = [...probeResult.byRoute].sort((a, b) => a.avgSpeedKph - b.avgSpeedKph).slice(0, 10);
for (const w of slowest) {
  console.log(`  ${w.route}: ${w.avgSpeedKph} km/h, delay ${w.avgDelaySeconds} s, ${w.sampleCount} samples`);
}

console.log(`\nTomTom speed profile by time slot:`);
for (const row of tomtomResult.summary.speedProfileMatrix) {
  console.log(`  ${row.slot}: ${row.avgSpeedKph}/${row.avgFreeFlowKph} km/h (ratio ${row.avgRatio}, delay ${row.avgDelay}s)`);
}

console.log("\nDone — outputs in data/derived/");
console.log("  probe-aggregation.json, calibration-results.json, tomtom-corridor-profiles.json, congestion-regimes.json");
console.log("  calibration-results.csv, speed-profiles.csv, congestion-summary.csv");
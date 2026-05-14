import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const provider = "tomtom";
const outputDir = process.env.TRAFFIC_FLOW_OUTPUT_DIR ?? "data/traffic-flow";
const dryRun = process.env.TRAFFIC_FLOW_DRY_RUN === "1" || process.argv.includes("--dry-run");
const usageLimitMonthly = Number(process.env.TOMTOM_MONTHLY_LIMIT ?? "500");
const usageLimitDaily = Number(process.env.TOMTOM_DAILY_LIMIT ?? "2500");
const bbox = (process.env.TRAFFIC_FLOW_BBOX ?? "21.19,45.73,21.24,45.77").split(",").map((v) => Number(v.trim()));
const [minLng, minLat, maxLng, maxLat] = bbox;

const timeSlots = [
  { label: "morning-rush", hour: 7, minute: 30 },
  { label: "mid-morning", hour: 10, minute: 0 },
  { label: "midday", hour: 12, minute: 0 },
  { label: "afternoon-rush", hour: 17, minute: 30 },
  { label: "evening", hour: 19, minute: 0 },
  { label: "night", hour: 22, minute: 0 },
];

const gridSize = 5;
const samplePoints = [];

const stepX = (maxLng - minLng) / (gridSize + 1);
const stepY = (maxLat - minLat) / (gridSize + 1);
for (let i = 1; i <= gridSize; i++) {
  for (let j = 1; j <= gridSize; j++) {
    samplePoints.push({
      id: `p-${i}-${j}`,
      lat: minLat + i * stepY,
      lng: minLng + j * stepX,
    });
  }
}

const routes = [
  { id: "rt-001", name: "Cetate-Istria", from: { lat: 45.7547, lng: 21.2224 }, to: { lat: 45.7624, lng: 21.2441 } },
  { id: "rt-002", name: "Dometi-Traian", from: { lat: 45.7452, lng: 21.2108 }, to: { lat: 45.7631, lng: 21.2289 } },
  { id: "rt-003", name: "Fratelia-Centro", from: { lat: 45.7378, lng: 21.1987 }, to: { lat: 45.7499, lng: 21.2275 } },
  { id: "rt-004", name: "Ghiroda-Aradului", from: { lat: 45.7698, lng: 21.2124 }, to: { lat: 45.7512, lng: 21.2367 } },
  { id: "rt-005", name: "ZonaIndustriala-Centru", from: { lat: 45.7356, lng: 21.2489 }, to: { lat: 45.7567, lng: 21.2245 } },
  { id: "rt-006", name: "Cipriana-Universitatii", from: { lat: 45.7412, lng: 21.2651 }, to: { lat: 45.7489, lng: 21.2504 } },
  { id: "rt-007", name: "Bucovina-Iosefin", from: { lat: 45.7612, lng: 21.2034 }, to: { lat: 45.7467, lng: 21.2189 } },
  { id: "rt-008", name: "Modei-Sagetii", from: { lat: 45.7289, lng: 21.2234 }, to: { lat: 45.7543, lng: 21.2387 } },
];

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "OpenTrafficTM traffic flow collector",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}\n${body.slice(0, 200)}`);
  }
  return response.json();
}

async function readUsageLedger() {
  const ledgerPath = `${outputDir}/usage-ledger.json`;
  try {
    const content = await readFile(ledgerPath, "utf8");
    return JSON.parse(content);
  } catch {
    return { monthly: 0, daily: 0, monthKey: "", dayKey: "" };
  }
}

async function writeUsageLedger(ledger) {
  await writeFile(`${outputDir}/usage-ledger.json`, `${JSON.stringify(ledger, null, 2)}\n`);
}

async function checkBudget(txCount) {
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
  const dayKey = now.toISOString().slice(0, 10);
  const ledger = await readUsageLedger();

  const monthTotal = ledger.monthKey === monthKey ? ledger.monthly : 0;
  const dayTotal = ledger.dayKey === dayKey ? ledger.daily : 0;

  if (monthTotal + txCount > usageLimitMonthly) {
    throw new Error(`Monthly cap exceeded: ${monthTotal + txCount}/${usageLimitMonthly}`);
  }
  if (dayTotal + txCount > usageLimitDaily) {
    throw new Error(`Daily cap exceeded: ${dayTotal + txCount}/${usageLimitDaily}`);
  }

  return { monthKey, dayKey, monthTotal, dayTotal };
}

function congestionLevel(currentSpeed, freeFlowSpeed) {
  if (currentSpeed == null || freeFlowSpeed == null || freeFlowSpeed === 0) return "unknown";
  const ratio = currentSpeed / freeFlowSpeed;
  if (ratio <= 0.4) return "severe";
  if (ratio <= 0.65) return "heavy";
  if (ratio <= 0.85) return "moderate";
  return "low";
}

function normalizeFlowSegment(data, pointId, collectedAt, slotHour) {
  const flow = data?.flowSegmentData;
  if (!flow) return [];

  const coords = flow.coordinates?.coordinate ?? [];
  const pts = Array.isArray(coords) ? coords : [coords];

  return pts.map((pt, idx) => ({
    pointId,
    collectedAt: collectedAt.toISOString(),
    slotHour,
    lat: pt.latitude ?? pt.lat ?? 0,
    lng: pt.longitude ?? pt.lng ?? 0,
    currentSpeedKph: flow.currentSpeed ?? null,
    freeFlowSpeedKph: flow.freeFlowSpeed ?? null,
    currentTravelTimeSec: flow.currentTravelTime ?? null,
    freeFlowTravelTimeSec: flow.freeFlowTravelTime ?? null,
    confidence: flow.confidence ?? 0.8,
    frc: flow.frc ?? null,
    roadClosure: flow.roadClosure ?? false,
    segmentIndex: idx,
    totalPoints: pts.length,
    speedRatio: (flow.currentSpeed && flow.freeFlowSpeed) ? flow.currentSpeed / flow.freeFlowSpeed : null,
    delaySeconds: (flow.currentSpeed != null && flow.freeFlowSpeed != null) ? Math.max(0, flow.freeFlowSpeed - flow.currentSpeed) * (flow.currentTravelTime / flow.currentSpeed) : null,
    congestionLevel: congestionLevel(flow.currentSpeed, flow.freeFlowSpeed),
  }));
}

async function fetchFlowPoint(apiKey, point, relative) {
  const version = relative ? "relative0" : "absolute";
  const unit = relative ? "KMPH" : "KMPH";
  const url = new URL(
    `https://api.tomtom.com/traffic/services/4/flowSegmentData/${version}/10/json`
  );
  url.searchParams.set("key", apiKey);
  url.searchParams.set("point", `${point.lat},${point.lng}`);
  url.searchParams.set("unit", unit);
  url.searchParams.set("openLr", "false");
  return fetchJson(url);
}

async function fetchIncidents(apiKey) {
  const url = new URL("https://api.tomtom.com/traffic/services/5/incidentDetails");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("bbox", `${minLng},${minLat},${maxLng},${maxLat}`);
  url.searchParams.set("fields", "{incidents{type,geometry{type,coordinates},properties{iconCategory}}}");
  url.searchParams.set("language", "en-GB");
  url.searchParams.set("timeValidityFilter", "present");
  return fetchJson(url);
}

async function main() {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) throw new Error("TOMTOM_API_KEY is required");

  await mkdir(`${outputDir}/archive`, { recursive: true });
  await mkdir(`${outputDir}/csv`, { recursive: true });
  await mkdir(`${outputDir}/points`, { recursive: true });

  const collectedAt = new Date();
  const stamp = collectedAt.toISOString().replaceAll(":", "-").replace(".", "-");
  const dateStr = collectedAt.toISOString().slice(0, 10);

  const txCount = samplePoints.length * 2 + 1;
  await checkBudget(txCount);

  if (dryRun) {
    const ledger = await readUsageLedger();
    console.log(`Dry run: ${txCount} tx (monthly ${ledger.monthly}/${usageLimitMonthly}, daily ${ledger.daily}/${usageLimitDaily})`);
    return;
  }

  const allFlowRecords = [];
  const allIncidents = [];
  let txUsed = 0;

  for (const slot of timeSlots) {
    const [y, mo, d] = dateStr.split("-");
    const slotTime = new Date(Number(y), Number(mo) - 1, Number(d), slot.hour, slot.minute);
    const slotLabel = slot.label;

    for (const point of samplePoints) {
      try {
        const [relData, absData] = await Promise.all([
          fetchFlowPoint(apiKey, point, true),
          fetchFlowPoint(apiKey, point, false),
        ]);

        const relRecords = normalizeFlowSegment(relData, point.id, slotTime, slot.hour);
        const absRecords = normalizeFlowSegment(absData, point.id, slotTime, slot.hour);

        relRecords.forEach((r) => (r.measurementMode = "relative"));
        absRecords.forEach((r) => (r.measurementMode = "absolute"));

        allFlowRecords.push(...relRecords, ...absRecords);
        txUsed += 2;

        const speedInfo = relRecords[0]?.currentSpeedKph != null
          ? `${relRecords[0].currentSpeedKph.toFixed(0)}/${relRecords[0]?.freeFlowSpeedKph?.toFixed(0)} kph [${relRecords[0]?.congestionLevel}]`
          : "no data";

        process.stdout.write(`[${txUsed}/${samplePoints.length * 2 + 1}] ${slotLabel} ${point.id}: ${speedInfo}\n`);
      } catch (err) {
        console.error(`\nFailed ${point.id} @ ${slotLabel}: ${err.message}`);
      }
    }
  }

  try {
    const incidentData = await fetchIncidents(apiKey);
    txUsed += 1;
    const items = incidentData?.incidents ?? [];
    allIncidents.push(
      ...items.map((item, idx) => ({
        collectedAt: collectedAt.toISOString(),
        timeSlot: "all",
        incidentId: item?.id ?? `inc-${idx}`,
        type: item?.properties?.iconCategory ?? item?.type ?? "unknown",
        severity: item?.properties?.magnitudeOfDelay ?? null,
        lat: item?.geometry?.coordinates?.[0]?.[1] ?? null,
        lng: item?.geometry?.coordinates?.[0]?.[0] ?? null,
      }))
    );
    console.log(`\nIncidents: ${allIncidents.length} collected`);
  } catch (err) {
    console.error(`Incident fetch failed: ${err.message}`);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const monthKey = todayStr.slice(0, 7);
  const dayKey = todayStr;
  const ledger = await readUsageLedger();
  await writeUsageLedger({
    monthKey,
    dailyKey: dayKey,
    monthly: (ledger.monthKey === monthKey ? ledger.monthly : 0) + txUsed,
    daily: (ledger.dayKey === dayKey ? ledger.daily : 0) + txUsed,
    updatedAt: collectedAt.toISOString(),
    limit: usageLimitMonthly,
    dailyLimit: usageLimitDaily,
  });

  const jsonOut = {
    provider,
    collectedAt: collectedAt.toISOString(),
    date: dateStr,
    timeSlots: timeSlots.map((s) => ({ ...s, date: dateStr })),
    bbox,
    pointCount: samplePoints.length,
    totalTransactions: txUsed,
    flowRecordCount: allFlowRecords.length,
    incidentCount: allIncidents.length,
    flow: allFlowRecords,
    incidents: allIncidents,
  };

  const archivePath = `${outputDir}/archive/${provider}-${stamp}.json`;
  const latestPath = `${outputDir}/${provider}-latest.json`;
  const flowCsvPath = `${outputDir}/csv/${provider}-flow-${stamp}.csv`;
  const summaryCsvPath = `${outputDir}/csv/${provider}-summary-${stamp}.csv`;
  const incidentsCsvPath = `${outputDir}/csv/${provider}-incidents-${stamp}.csv`;

  await writeFile(archivePath, `${JSON.stringify(jsonOut, null, 2)}\n`);
  await writeFile(latestPath, `${JSON.stringify(jsonOut, null, 2)}\n`);
  await writeFile(flowCsvPath, toCSV(allFlowRecords));
  await writeFile(summaryCsvPath, toCSV(buildSummary(allFlowRecords, timeSlots)));
  await writeFile(incidentsCsvPath, toCSV(allIncidents));

  console.log(`\nDone. ${txUsed} transactions, ${allFlowRecords.length} flow records, ${allIncidents.length} incidents.`);
  console.log(`Files: ${archivePath}`);
  console.log(`       ${flowCsvPath}`);
  console.log(`       ${summaryCsvPath}`);
  console.log(`       ${incidentsCsvPath}`);
}

function buildSummary(records, timeSlots) {
  return timeSlots.map((slot) => {
    const slotRecords = records.filter((r) => r.slotHour === slot.hour);

    const speeds = slotRecords.map((r) => r.currentSpeedKph).filter((v) => v != null);
    const freeSpeeds = slotRecords.map((r) => r.freeFlowSpeedKph).filter((v) => v != null);
    const ratios = slotRecords.map((r) => r.speedRatio).filter((v) => v != null);

    const avgSpeed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
    const avgRatio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
    const congestionCounts = {};
    slotRecords.forEach((r) => {
      const lvl = r.congestionLevel ?? "unknown";
      congestionCounts[lvl] = (congestionCounts[lvl] ?? 0) + 1;
    });

    return {
      timeSlot: slot.label,
      hour: slot.hour,
      sampleCount: slotRecords.length,
      avgSpeedKph: avgSpeed ? Math.round(avgSpeed * 10) / 10 : null,
      avgSpeedRatio: avgRatio ? Math.round(avgRatio * 1000) / 1000 : null,
      congestionDistribution: JSON.stringify(congestionCounts),
      severeCount: congestionCounts.severe ?? 0,
      heavyCount: congestionCounts.heavy ?? 0,
      moderateCount: congestionCounts.moderate ?? 0,
      lowCount: congestionCounts.low ?? 0,
    };
  });
}

function toCSV(records) {
  if (records.length === 0) return "";
  const headers = Object.keys(records[0]);
  const rows = records.map((obj) =>
    headers.map((h) => {
      const val = obj[h];
      if (val == null) return "";
      if (typeof val === "string" && (val.includes(",") || val.includes('"'))) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return String(val);
    }).join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
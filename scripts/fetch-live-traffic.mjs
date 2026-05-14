import { mkdir, readFile, writeFile } from "node:fs/promises";

const API_KEY = process.env.TOMTOM_API_KEY ?? "da3XYDDUWFH7JUv8RkRUjwcJLWWpt5bW";
const OUTPUT_DIR = process.env.TRAFFIC_LIVE_OUTPUT_DIR ?? "data/traffic-live";
const DRY_RUN = process.env.TRAFFIC_LIVE_DRY_RUN === "1";

const bbox = { minLng: 21.19, maxLng: 21.24, minLat: 45.73, maxLat: 45.77 };

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function fetchFlowSegment(lat, lng, retries = 2) {
  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json?key=${API_KEY}&point=${lat},${lng}&unit=KMPH`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt)));
    }
  }
}

function congestionLevel(currentSpeed, freeFlowSpeed) {
  if (currentSpeed == null || freeFlowSpeed == null || freeFlowSpeed === 0) return "unknown";
  const ratio = currentSpeed / freeFlowSpeed;
  if (ratio <= 0.4) return "severe";
  if (ratio <= 0.65) return "heavy";
  if (ratio <= 0.85) return "moderate";
  return "low";
}

function normalizeSegment(data, roadId) {
  const flow = data?.flowSegmentData;
  if (!flow) return null;

  const coords = flow.coordinates?.coordinate;
  const pts = Array.isArray(coords) ? coords : [];

  if (pts.length === 0) return null;

  return {
    roadId,
    speedKph: flow.currentSpeed ?? null,
    freeFlowKph: flow.freeFlowSpeed ?? null,
    currentTravelTimeSec: flow.currentTravelTime ?? null,
    freeFlowTravelTimeSec: flow.freeFlowTravelTime ?? null,
    confidence: flow.confidence ?? 0.8,
    frc: flow.frc ?? null,
    roadClosure: flow.roadClosure ?? false,
    delaySeconds:
      flow.currentSpeed != null && flow.freeFlowSpeed != null
        ? Math.max(0, ((flow.freeFlowSpeed - flow.currentSpeed) / flow.freeFlowSpeed) * 100).toFixed(1)
        : null,
    congestionLevel: congestionLevel(flow.currentSpeed, flow.freeFlowSpeed),
    coordinates: pts.map((pt) => ({
      lat: pt.latitude ?? pt.lat ?? 0,
      lng: pt.longitude ?? pt.lng ?? 0,
    })),
  };
}

async function main() {
  await mkdir(`${OUTPUT_DIR}/archive`, { recursive: true });
  await mkdir(`${OUTPUT_DIR}/roads`, { recursive: true });

  const surveyData = await readJson("data/tomtom-roads-live.json");
  if (!surveyData) {
    console.error("No survey data found. Run scripts/survey-roads.mjs first.");
    process.exit(1);
  }

  const now = new Date();
  const stamp = now.toISOString().replaceAll(":", "-").replace(".", "-");
  const dateStr = now.toISOString().slice(0, 10);
  const hour = now.getHours();

  const results = [];
  const errors = [];

  console.log(`Fetching live data for ${surveyData.length} roads...`);

  for (let i = 0; i < surveyData.length; i += 5) {
    const batch = surveyData.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(async (road, bi) => {
        const sample = road.samplePoint;
        try {
          const data = await fetchFlowSegment(sample.lat, sample.lng);
          const segment = normalizeSegment(data, `road-${i + bi}`);
          return { roadIndex: i + bi, segment, error: null };
        } catch (err) {
          return { roadIndex: i + bi, segment: null, error: err.message };
        }
      })
    );

    for (const r of batchResults) {
      if (r.segment) {
        results.push(r.segment);
      } else {
        errors.push({ index: r.roadIndex, error: r.error });
      }
    }

    process.stdout.write(`\r${Math.min(i + 5, surveyData.length)}/${surveyData.length} done (${results.length} roads, ${errors.length} failed)`);
  }
  console.log("");

  if (errors.length > 0) {
    console.log(`Failed roads: ${errors.length}`);
  }

  const liveSnapshot = {
    provider: "tomtom-live",
    collectedAt: now.toISOString(),
    date: dateStr,
    hour,
    totalRoads: results.length,
    failedRoads: errors.length,
    roads: results,
  };

  const latestPath = `${OUTPUT_DIR}/tomtom-latest.json`;
  const archivePath = `${OUTPUT_DIR}/archive/${dateStr}-${stamp}.json`;
  const hourPath = `${OUTPUT_DIR}/archive/${dateStr}-h${String(hour).padStart(2, "0")}.json`;

  await writeFile(latestPath, JSON.stringify(liveSnapshot, null, 2) + "\n");
  await writeFile(archivePath, JSON.stringify(liveSnapshot, null, 2) + "\n");
  await writeFile(hourPath, JSON.stringify(liveSnapshot, null, 2) + "\n");

  const geojson = {
    type: "FeatureCollection",
    features: results.map((road, idx) => ({
      type: "Feature",
      properties: {
        roadId: road.roadId,
        speed: road.speedKph,
        freeFlow: road.freeFlowKph,
        congestionLevel: road.congestionLevel,
        delaySeconds: road.delaySeconds,
        confidence: road.confidence,
        frc: road.frc,
        roadClosure: road.roadClosure,
        probeKey: `live:${road.roadId}`,
      },
      geometry: {
        type: "LineString",
        coordinates: road.coordinates.map((c) => [c.lng, c.lat]),
      },
    })),
  };

  const geojsonPath = `${OUTPUT_DIR}/tomtom-live-geojson.json`;
  await writeFile(geojsonPath, JSON.stringify(geojson, null, 2) + "\n");

  const summary = {
    total: results.length,
    byCongestion: results.reduce((acc, r) => {
      acc[r.congestionLevel] = (acc[r.congestionLevel] ?? 0) + 1;
      return acc;
    }, {}),
    byFrc: results.reduce((acc, r) => {
      acc[r.frc] = (acc[r.frc] ?? 0) + 1;
      return acc;
    }, {}),
    closures: results.filter((r) => r.roadClosure).length,
    avgSpeed: results.length
      ? (results.reduce((a, r) => a + (r.speedKph ?? 0), 0) / results.length).toFixed(1)
      : null,
    freeFlowAvg: results.length
      ? (results.reduce((a, r) => a + (r.freeFlowKph ?? 0), 0) / results.length).toFixed(1)
      : null,
  };

  console.log(`\nSaved ${results.length} roads to ${latestPath}`);
  console.log(
    `Congestion: ${JSON.stringify(summary.byCongestion)} | FRC: ${JSON.stringify(summary.byFrc)}`
  );
  console.log(`Closures: ${summary.closures} | Avg speed: ${summary.avgSpeed}/${summary.freeFlowAvg} kph`);
  console.log(`GeoJSON: ${geojsonPath}`);

  if (!DRY_RUN) {
    await writeFile(
      `${OUTPUT_DIR}/summary.json`,
      JSON.stringify({ ...summary, updatedAt: now.toISOString(), date: dateStr, hour }, null, 2) + "\n"
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
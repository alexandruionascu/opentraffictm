const API_KEY = process.env.TOMTOM_API_KEY;
import { writeFileSync } from "node:fs";

const bbox = { minLng: 21.19, maxLng: 21.24, minLat: 45.73, maxLat: 45.77 };
const gridSize = 15;
const stepX = (bbox.maxLng - bbox.minLng) / (gridSize + 1);
const stepY = (bbox.maxLat - bbox.minLat) / (gridSize + 1);
const points = [];

for (let i = 1; i <= gridSize; i++) {
  for (let j = 1; j <= gridSize; j++) {
    points.push({ lat: bbox.minLat + i * stepY, lng: bbox.minLng + j * stepX });
  }
}

async function fetchPoint(pt) {
  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json?key=${API_KEY}&point=${pt.lat},${pt.lng}&unit=KMPH`;
  const r = await fetch(url);
  return { pt, status: r.status, data: await r.json() };
}

async function main() {
  const results = [];
  for (let i = 0; i < points.length; i += 5) {
    const batch = points.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map((p) => fetchPoint(p).catch((e) => ({ pt: p, status: -1, data: null, error: e.message })))
    );
    results.push(...batchResults);
    process.stdout.write(`\r${i + batch.length}/${points.length} done`);
  }
  console.log("");

  const withData = results.filter((r) => r.status === 200 && r.data?.flowSegmentData?.coordinates?.coordinate?.length > 0);

  const roads = new Map();

  for (const r of withData) {
    const coords = r.data.flowSegmentData.coordinates.coordinate;
    const key = coords.map((c) => `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`).join("|");
    if (!roads.has(key)) {
      roads.set(key, {
        coordCount: coords.length,
        speed: r.data.flowSegmentData.currentSpeed,
        freeFlow: r.data.flowSegmentData.freeFlowSpeed,
        confidence: r.data.flowSegmentData.confidence,
        frc: r.data.flowSegmentData.frc,
        closure: r.data.flowSegmentData.roadClosure,
        samplePoint: r.pt,
      });
    }
  }

  console.log("Total grid points:", points.length);
  console.log("Points with data:", withData.length);
  console.log("Unique road segments:", roads.size);

  const roadArray = [...roads.entries()].map(([key, v]) => ({
    ...v,
    coordinates: key.split("|").map((p) => {
      const [lat, lng] = p.split(",");
      return { lat: parseFloat(lat), lng: parseFloat(lng) };
    }),
  }));

  writeFileSync("data/tomtom-roads-live.json", JSON.stringify(roadArray, null, 2));
  console.log("Saved to data/tomtom-roads-live.json");

  roadArray.slice(0, 5).forEach((r, i) => {
    console.log(`Road ${i + 1}: ${r.coordCount} coords, speed ${r.speed}/${r.freeFlow} kph, FRC ${r.frc}, closure ${r.closure}`);
    console.log("  first coord:", JSON.stringify(r.coordinates[0]));
    console.log("  last coord:", JSON.stringify(r.coordinates[r.coordinates.length - 1]));
  });
}

main().catch(console.error);
import { mkdir, writeFile } from "node:fs/promises";

const bbox = {
  south: 45.68,
  west: 21.12,
  north: 45.82,
  east: 21.34,
};

const overpassUrl = "https://overpass-api.de/api/interpreter";
const query = `
[out:json][timeout:180];
(
  way["highway"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["highway"="traffic_signals"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["highway"="crossing"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out tags geom;
`;

const roadClassOrder = new Map([
  ["motorway", 9],
  ["trunk", 8],
  ["primary", 7],
  ["secondary", 6],
  ["tertiary", 5],
  ["unclassified", 4],
  ["residential", 3],
  ["service", 2],
  ["footway", 1],
  ["path", 1],
  ["cycleway", 1],
]);

function roadRank(tags = {}) {
  return roadClassOrder.get(tags.highway) ?? 2;
}

function featureCollection(features) {
  return {
    type: "FeatureCollection",
    generatedAt: new Date().toISOString(),
    source: "OpenStreetMap via Overpass API",
    bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
    features,
  };
}

function lineFeature(element) {
  return {
    type: "Feature",
    id: `way/${element.id}`,
    properties: {
      osmId: element.id,
      name: element.tags?.name ?? null,
      highway: element.tags?.highway ?? "unknown",
      oneway: element.tags?.oneway ?? null,
      maxspeed: element.tags?.maxspeed ?? null,
      lanes: element.tags?.lanes ?? null,
      rank: roadRank(element.tags),
    },
    geometry: {
      type: "LineString",
      coordinates: element.geometry.map((point) => [point.lon, point.lat]),
    },
  };
}

function pointFeature(element) {
  const kind = element.tags?.highway === "traffic_signals" ? "traffic_signal" : "crossing";

  return {
    type: "Feature",
    id: `node/${element.id}`,
    properties: {
      osmId: element.id,
      kind,
      name: element.tags?.name ?? null,
      crossing: element.tags?.crossing ?? null,
    },
    geometry: {
      type: "Point",
      coordinates: [element.lon, element.lat],
    },
  };
}

async function main() {
  const response = await fetch(overpassUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "user-agent": "OpenTrafficTM hackathon data bootstrap",
    },
    body: new URLSearchParams({ data: query }),
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const roads = [];
  const signalsAndCrossings = [];

  for (const element of json.elements ?? []) {
    if (element.type === "way" && Array.isArray(element.geometry) && element.geometry.length > 1) {
      roads.push(lineFeature(element));
    }

    if (element.type === "node" && typeof element.lon === "number" && typeof element.lat === "number") {
      signalsAndCrossings.push(pointFeature(element));
    }
  }

  await mkdir("data/osm", { recursive: true });
  await writeFile("data/osm/timisoara-roads.geojson", `${JSON.stringify(featureCollection(roads), null, 2)}\n`);
  await writeFile(
    "data/osm/timisoara-controls.geojson",
    `${JSON.stringify(featureCollection(signalsAndCrossings), null, 2)}\n`,
  );
  await writeFile(
    "data/osm/timisoara-osm-manifest.json",
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: overpassUrl,
        bbox,
        query,
        roads: roads.length,
        controls: signalsAndCrossings.length,
        outputFiles: ["data/osm/timisoara-roads.geojson", "data/osm/timisoara-controls.geojson"],
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Wrote ${roads.length} roads and ${signalsAndCrossings.length} controls/crossings.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

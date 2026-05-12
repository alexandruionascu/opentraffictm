import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env.STPT_LIVE_BASE_URL ?? "https://live.stpt.ro";
const outputDir = process.env.STPT_LIVE_OUTPUT_DIR ?? "data/sources/stpt-live";
const routeFilter = process.env.STPT_ROUTES
  ? new Set(process.env.STPT_ROUTES.split(",").map((route) => route.trim()).filter(Boolean))
  : undefined;

async function fetchJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      accept: "application/json",
      "user-agent": "OpenTrafficTM STPT live collector",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${path}`);
  }

  return response.json();
}

function discoverRoutes(stationsIndex) {
  const routes = new Set();

  for (const station of Object.values(stationsIndex ?? {})) {
    for (const line of station.lines ?? []) {
      if (line.line) routes.add(String(line.line));
    }
  }

  return [...routes]
    .filter((route) => !routeFilter || routeFilter.has(route))
    .sort((a, b) => a.localeCompare(b, "ro", { numeric: true }));
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let index = 0;

  async function run() {
    while (index < items.length) {
      const itemIndex = index;
      index += 1;
      results[itemIndex] = await worker(items[itemIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function normalizeVehicle(vehicle, route) {
  const lat = Number(vehicle.lat);
  const lng = Number(vehicle.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined;
  }

  return {
    id: String(vehicle.id ?? vehicle.vehicleId ?? vehicle.licensePlate ?? `${route}-${lat}-${lng}`),
    route: String(vehicle.route ?? vehicle.route_id ?? vehicle.line ?? route),
    lat,
    lng,
    bearing: Number(vehicle.bearing ?? 0),
    speed: Number(vehicle.speed ?? 0),
    directionId: vehicle.directionId === undefined ? null : String(vehicle.directionId),
    headsign: vehicle.headsign ?? null,
    stop: vehicle.stop ?? null,
    timestamp: Number(vehicle.timestamp ?? Date.now()),
    isAccessible: Boolean(vehicle.isAccessible),
  };
}

function vehiclesToGeoJson(vehicles) {
  return {
    type: "FeatureCollection",
    features: vehicles.map((vehicle) => ({
      type: "Feature",
      properties: {
        id: vehicle.id,
        route: vehicle.route,
        bearing: vehicle.bearing,
        speed: vehicle.speed,
        directionId: vehicle.directionId,
        headsign: vehicle.headsign,
        stop: vehicle.stop,
        timestamp: vehicle.timestamp,
        isAccessible: vehicle.isAccessible,
      },
      geometry: {
        type: "Point",
        coordinates: [vehicle.lng, vehicle.lat],
      },
    })),
  };
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(`${outputDir}/archive`, { recursive: true });

  const collectedAt = new Date();
  const stamp = collectedAt.toISOString().replaceAll(":", "-").replace(".", "-");
  const stationsIndex = await fetchJson("/stations-index.php");
  const routes = discoverRoutes(stationsIndex);

  const routeResponses = await mapLimit(routes, 8, async (route) => {
    try {
      const json = await fetchJson(`/gtfs-vehicles.php?route=${encodeURIComponent(route)}`);
      return {
        route,
        ok: true,
        vehicles: (json.data?.vehicles ?? []).map((vehicle) => normalizeVehicle(vehicle, route)).filter(Boolean),
      };
    } catch (error) {
      return {
        route,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        vehicles: [],
      };
    }
  });

  const byVehicle = new Map();
  for (const response of routeResponses) {
    for (const vehicle of response.vehicles) {
      byVehicle.set(`${vehicle.route}:${vehicle.id}`, vehicle);
    }
  }

  const vehicles = [...byVehicle.values()].sort((a, b) => a.route.localeCompare(b.route, "ro", { numeric: true }));
  const snapshot = {
    collectedAt: collectedAt.toISOString(),
    source: `${baseUrl}/gtfs-vehicles.php?route={route}`,
    attribution: "Copyright © Romania, 2024, Tranzy AI SRL & Societatea de Transport Public Timișoara SA. All rights reserved.",
    routeCount: routes.length,
    vehicleCount: vehicles.length,
    routes,
    failures: routeResponses.filter((response) => !response.ok).map(({ route, error }) => ({ route, error })),
    vehicles,
  };
  const geojson = vehiclesToGeoJson(vehicles);

  await writeFile(`${outputDir}/stations-index.json`, `${JSON.stringify(stationsIndex, null, 2)}\n`);
  await writeFile(`${outputDir}/latest-vehicles.json`, `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFile(`${outputDir}/latest-vehicles.geojson`, `${JSON.stringify(geojson, null, 2)}\n`);
  await writeFile(`${outputDir}/archive/${stamp}-vehicles.json`, `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFile(`${outputDir}/archive/${stamp}-vehicles.geojson`, `${JSON.stringify(geojson, null, 2)}\n`);
  await writeFile(
    `${outputDir}/manifest.json`,
    `${JSON.stringify(
      {
        generatedAt: collectedAt.toISOString(),
        baseUrl,
        routesDiscovered: routes.length,
        latestVehicleCount: vehicles.length,
        latestJson: `${outputDir}/latest-vehicles.json`,
        latestGeoJson: `${outputDir}/latest-vehicles.geojson`,
        archiveDir: `${outputDir}/archive`,
        attribution: snapshot.attribution,
        caveat:
          "This is live public transport vehicle data, not private-car traffic. Use it as observed transit/probe movement and corridor-delay evidence.",
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Fetched ${vehicles.length} live STPT vehicles across ${routes.length} routes.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

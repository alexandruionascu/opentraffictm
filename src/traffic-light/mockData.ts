import signalsJson from "../../data/traffic-lights/signals.json";
import type { TrafficLightDataset, TrafficLightLocation, TrafficGpsObservation, TrafficStopLocation, TrafficVehicleTrace } from "./types";

type SignalsJson = {
  generatedAt: string;
  scope: string;
  programs: Array<{
    id: string;
    name: string;
    position: { lng: number; lat: number };
    primaryHeadingDeg?: number;
    offsetSeconds?: number;
    phases?: Array<{ state: string; durationSeconds: number }>;
    osmId?: number;
    sampleCount?: number;
  }>;
};

type Manifest = {
  generatedAt: string;
  scope: string;
  files: Array<{
    file: string;
    route: string;
    partition: number;
    partitionCount: number;
    rows: number;
    bytes: number;
  }>;
};

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += char;
    }
  }

  cells.push(value);
  return cells;
}

function toNumber(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildBusStops(observations: TrafficGpsObservation[]): TrafficStopLocation[] {
  const grouped = new Map<string, TrafficGpsObservation[]>();
  for (const observation of observations) {
    const stop = observation.stopName?.trim();
    if (!stop || stop.length < 3) {
      continue;
    }
    const existing = grouped.get(stop) ?? [];
    existing.push(observation);
    grouped.set(stop, existing);
  }

  return [...grouped.entries()]
    .map(([name, points]) => ({
      name,
      lng: points.reduce((total, point) => total + point.lon, 0) / points.length,
      lat: points.reduce((total, point) => total + point.lat, 0) / points.length,
      sampleCount: points.length,
    }))
    .filter((stop) => stop.sampleCount >= 4)
    .sort((a, b) => b.sampleCount - a.sampleCount)
    .slice(0, 24);
}

function sampleTrace(points: TrafficGpsObservation[], maxPoints = 90) {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index % step === 0);
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function readText(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.text();
}

export async function loadTrafficLightDataset(): Promise<TrafficLightDataset> {
  const manifest = await readJson<Manifest>("/data/traffic-lights/analysis/export-manifest.json");
  const sourceFiles = manifest.files.map((file) => file.file);
  const csvRows = await Promise.all(
    sourceFiles.map(async (file) => {
      const text = await readText(`/data/traffic-lights/analysis/${file}`);
      return text
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => parseCsvLine(line))
        .filter((cells) => cells.length >= 12)
        .map((cells) => ({
          vehicleId: cells[0],
          routeId: cells[1],
          directionId: cells[2] || undefined,
          timestamp: Number(cells[4]) || Date.parse(cells[3]),
          lat: Number(cells[5]),
          lon: Number(cells[6]),
          speedKph: toNumber(cells[8]),
          headsign: cells[9] || undefined,
          stopName: cells[10] || undefined,
          sourceFile: file,
        }))
        .filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.lat) && Number.isFinite(row.lon));
    }),
  );

  const observations = csvRows.flat() as TrafficGpsObservation[];
  const busStops = buildBusStops(observations);
  const traceBuckets = new Map<string, TrafficGpsObservation[]>();
  for (const observation of observations) {
    const key = `${observation.routeId}:${observation.vehicleId}:${observation.directionId ?? "na"}`;
    const existing = traceBuckets.get(key) ?? [];
    existing.push(observation);
    traceBuckets.set(key, existing);
  }

  const inferenceTracesByRoute = new Map<string, TrafficVehicleTrace[]>();
  const displayTracesByRoute = new Map<string, TrafficVehicleTrace[]>();
  for (const [id, points] of traceBuckets.entries()) {
    const sorted = points.sort((a, b) => a.timestamp - b.timestamp);
    const routeId = sorted[0]?.routeId ?? "unknown";
    const inferenceTrace: TrafficVehicleTrace = {
      id,
      vehicleId: sorted[0]?.vehicleId ?? id,
      routeId,
      directionId: sorted[0]?.directionId,
      observations: sorted,
    };
    const displayTrace: TrafficVehicleTrace = {
      ...inferenceTrace,
      observations: sampleTrace(sorted),
    };
    const inferenceList = inferenceTracesByRoute.get(routeId) ?? [];
    inferenceList.push(inferenceTrace);
    inferenceTracesByRoute.set(routeId, inferenceList);
    const displayList = displayTracesByRoute.get(routeId) ?? [];
    displayList.push(displayTrace);
    displayTracesByRoute.set(routeId, displayList);
  }

  const traces = [...displayTracesByRoute.entries()]
    .flatMap(([, routeTraces]) =>
      routeTraces
        .sort((a, b) => b.observations.length - a.observations.length)
        .slice(0, 4),
    )
    .sort((a, b) => b.observations.length - a.observations.length)
    .slice(0, 48);

  const inferenceTraces = [...inferenceTracesByRoute.values()]
    .flat()
    .sort((a, b) => a.routeId.localeCompare(b.routeId) || a.vehicleId.localeCompare(b.vehicleId));

  const lights: TrafficLightLocation[] = ((signalsJson as SignalsJson).programs ?? []).map((program) => ({
    id: program.id,
    name: program.name,
    lng: program.position.lng,
    lat: program.position.lat,
    osmId: program.osmId,
    headingDeg: program.primaryHeadingDeg,
    sampleCount: program.sampleCount,
  }));

  return {
    loadedAt: new Date().toISOString(),
    sourceFiles,
    lights,
    traces,
    inferenceTraces,
    busStops,
  };
}

import fs from "node:fs";
import path from "node:path";
import signalsJson from "../data/traffic-lights/signals.json";
import { extractTrafficLightPasses } from "../src/traffic-light/passExtraction";
import {
  estimateTrafficLightPhases,
  finalizeTrafficLightEstimate,
  synchronizeNeighborOffsets,
} from "../src/traffic-light/phaseEstimation";
import { haversineMeters } from "../src/traffic-light/mapMatching";
import type {
  PrecomputedTrafficLightDataset,
  TrafficLightEvidencePath,
  TrafficGpsObservation,
  TrafficLightDataset,
  TrafficLightLocation,
  TrafficStopLocation,
  TrafficVehicleTrace,
} from "../src/traffic-light/types";

type SignalsJson = {
  generatedAt: string;
  scope: string;
  programs: Array<{
    id: string;
    name: string;
    position: { lng: number; lat: number };
    primaryHeadingDeg?: number;
    osmId?: number;
    sampleCount?: number;
  }>;
};

type Manifest = {
  generatedAt: string;
  files: Array<{
    file: string;
    route: string;
    partition: number;
    partitionCount: number;
    rows: number;
    bytes: number;
  }>;
};

const repoRoot = process.cwd();
const analysisDir = path.join(repoRoot, "data/traffic-lights/analysis");
const outputFile = path.join(analysisDir, "inference.json");

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

function sampleTrace(points: TrafficGpsObservation[], maxPoints = 90) {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index % step === 0);
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

function loadObservations(manifest: Manifest) {
  return manifest.files.flatMap((entry) => {
    const text = fs.readFileSync(path.join(analysisDir, entry.file), "utf8");
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
        sourceFile: entry.file,
      }))
      .filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.lat) && Number.isFinite(row.lon));
  }) as TrafficGpsObservation[];
}

function buildTraces(observations: TrafficGpsObservation[]) {
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

  return { traces, inferenceTraces };
}

function buildLights(): TrafficLightLocation[] {
  return ((signalsJson as SignalsJson).programs ?? []).map((program) => ({
    id: program.id,
    name: program.name,
    lng: program.position.lng,
    lat: program.position.lat,
    osmId: program.osmId,
    headingDeg: program.primaryHeadingDeg,
    sampleCount: program.sampleCount,
  }));
}

function buildRepresentativePath(
  light: TrafficLightLocation | undefined,
  traces: TrafficVehicleTrace[],
  routeId: string,
  directionId: string | undefined,
) {
  if (!light) {
    return undefined;
  }

  const candidate = traces
    .filter((trace) => trace.routeId === routeId && (trace.directionId ?? undefined) === (directionId ?? undefined))
    .map((trace) => {
      let closestIndex = -1;
      let closestDistance = Infinity;
      for (let index = 0; index < trace.observations.length; index += 1) {
        const point = trace.observations[index];
        const distance = haversineMeters({ lng: point.lon, lat: point.lat }, { lng: light.lng, lat: light.lat });
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      }
      return { trace, closestIndex, closestDistance };
    })
    .filter((item) => item.closestIndex >= 0 && item.closestDistance <= 150)
    .sort((a, b) => a.closestDistance - b.closestDistance || b.trace.observations.length - a.trace.observations.length)[0];

  if (!candidate) {
    return undefined;
  }

  const window = candidate.trace.observations.slice(
    Math.max(0, candidate.closestIndex - 18),
    Math.min(candidate.trace.observations.length, candidate.closestIndex + 12),
  );
  const filtered = window.filter(
    (point) => haversineMeters({ lng: point.lon, lat: point.lat }, { lng: light.lng, lat: light.lat }) <= 360,
  );
  if (filtered.length < 2) {
    return undefined;
  }

  const step = Math.max(1, Math.ceil(filtered.length / 18));
  const sampled = filtered
    .filter((_, index) => index % step === 0)
    .map((point) => ({
      lat: Number(point.lat.toFixed(6)),
      lon: Number(point.lon.toFixed(6)),
    }));
  return sampled.filter((point, index) => {
    const previous = sampled[index - 1];
    return !previous || previous.lat !== point.lat || previous.lon !== point.lon;
  });
}

function buildEvidencePaths(
  passes: ReturnType<typeof extractTrafficLightPasses>,
  lights: TrafficLightLocation[],
  inferenceTraces: TrafficVehicleTrace[],
) {
  const grouped = new Map<
    string,
    {
      lightId: string;
      routeKey: string;
      routeId: string;
      directionId?: string;
      headingSin: number;
      headingCos: number;
      passCount: number;
      stopPassCount: number;
      greenPassCount: number;
      redPassCount: number;
      confidenceSum: number;
    }
  >();

  for (const pass of passes) {
    const routeKey = `${pass.routeId}:${pass.directionId ?? "na"}`;
    const key = `${pass.lightId}:${routeKey}`;
    const headingRad = (pass.approachHeadingDeg * Math.PI) / 180;
    const existing = grouped.get(key) ?? {
      lightId: pass.lightId,
      routeKey,
      routeId: pass.routeId,
      directionId: pass.directionId,
      headingSin: 0,
      headingCos: 0,
      passCount: 0,
      stopPassCount: 0,
      greenPassCount: 0,
      redPassCount: 0,
      confidenceSum: 0,
    };
    existing.headingSin += Math.sin(headingRad) * pass.confidence;
    existing.headingCos += Math.cos(headingRad) * pass.confidence;
    existing.passCount += 1;
    existing.stopPassCount += pass.stoppedBeforeLight ? 1 : 0;
    existing.greenPassCount += pass.passState === "green" ? 1 : 0;
    existing.redPassCount += pass.passState === "red" ? 1 : 0;
    existing.confidenceSum += pass.confidence;
    grouped.set(key, existing);
  }

  return [...grouped.values()].reduce<Record<string, TrafficLightEvidencePath[]>>((byLight, item) => {
    const light = lights.find((candidate) => candidate.id === item.lightId);
    const headingDeg = ((Math.atan2(item.headingSin, item.headingCos) * 180) / Math.PI + 360) % 360;
    const path: TrafficLightEvidencePath = {
      lightId: item.lightId,
      routeKey: item.routeKey,
      routeId: item.routeId,
      directionId: item.directionId,
      approachHeadingDeg: Number(headingDeg.toFixed(1)),
      points: buildRepresentativePath(light, inferenceTraces, item.routeId, item.directionId),
      passCount: item.passCount,
      stopPassCount: item.stopPassCount,
      greenPassCount: item.greenPassCount,
      redPassCount: item.redPassCount,
      confidence: Number(Math.max(0.1, Math.min(0.98, item.confidenceSum / Math.max(1, item.passCount))).toFixed(3)),
    };
    const list = byLight[item.lightId] ?? [];
    list.push(path);
    byLight[item.lightId] = list
      .sort((a, b) => b.passCount - a.passCount || b.confidence - a.confidence)
      .slice(0, 12);
    return byLight;
  }, {});
}

export function buildTrafficLightInference() {
  const manifest = JSON.parse(fs.readFileSync(path.join(analysisDir, "export-manifest.json"), "utf8")) as Manifest;
  const observations = loadObservations(manifest);
  const busStops = buildBusStops(observations);
  const { traces, inferenceTraces } = buildTraces(observations);
  const lights = buildLights();
  const passes = extractTrafficLightPasses(lights, inferenceTraces, busStops);
  const seeded = lights.map((light) => estimateTrafficLightPhases(light, passes));
  const synced = synchronizeNeighborOffsets(seeded, lights);
  const estimates = synced.map((estimate) =>
    finalizeTrafficLightEstimate(lights.find((light) => light.id === estimate.lightId) ?? lights[0], estimate),
  );
  const passCountsByLightId = passes.reduce<Record<string, number>>((counts, pass) => {
    counts[pass.lightId] = (counts[pass.lightId] ?? 0) + 1;
    return counts;
  }, {});
  const evidencePathsByLightId = buildEvidencePaths(passes, lights, inferenceTraces);
  const dataset = {
    loadedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    sourceFiles: manifest.files.map((entry) => entry.file),
    lights,
    traces,
    busStops,
    estimates,
    passCount: passes.length,
    passCountsByLightId,
    evidencePathsByLightId,
  } satisfies PrecomputedTrafficLightDataset & Pick<TrafficLightDataset, "loadedAt"> & { generatedAt: string };

  fs.writeFileSync(outputFile, `${JSON.stringify(dataset)}\n`);
  return {
    outputFile,
    observations: observations.length,
    traces: traces.length,
    inferenceTraces: inferenceTraces.length,
    lights: lights.length,
    passes: passes.length,
    estimates: estimates.length,
  };
}

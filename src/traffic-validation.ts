export type TrafficProvider = "google" | "here" | "tomtom" | "timisoara-stpt" | "timisoara-closures";

export interface TrafficValidationRequest {
  provider: TrafficProvider;
  requestId: string;
  requestedAt: string;
  windowStart: string;
  windowEnd: string;
  bbox: [number, number, number, number];
  corridor?: string;
  mode?: string;
}

export interface TrafficSegmentSnapshot {
  segmentId: string;
  roadName?: string;
  geometry: [number, number][];
  speedKph?: number;
  travelTimeSeconds?: number;
  delaySeconds?: number;
  congestionLevel?: "low" | "moderate" | "heavy" | "severe";
  confidence?: number;
}

export interface TrafficIncidentSnapshot {
  incidentId: string;
  kind: string;
  description?: string;
  severity?: number;
  geometry?: [number, number][];
}

export interface TrafficSnapshot {
  provider: TrafficProvider;
  requestId: string;
  requestedAt: string;
  windowStart: string;
  windowEnd: string;
  bbox: [number, number, number, number];
  corridor?: string;
  mode?: string;
  segments: TrafficSegmentSnapshot[];
  incidents: TrafficIncidentSnapshot[];
  rawStored: boolean;
}

export interface ValidationMetric {
  name: string;
  expected: number;
  observed: number;
  delta: number;
}

export interface ValidationResult {
  snapshotId: string;
  modelRunId: string;
  scenarioId: string;
  provider: TrafficProvider;
  requestedAt: string;
  accepted: boolean;
  metrics: ValidationMetric[];
  notes?: string;
}

export interface TrafficProviderAdapter {
  provider: TrafficProvider;
  supportsRawCaching: boolean;
  fetchSnapshot(request: TrafficValidationRequest): Promise<TrafficSnapshot>;
}

export const trafficValidationFolderContract = [
  "data/traffic-validation/providers/",
  "data/traffic-validation/raw/",
  "data/traffic-validation/snapshots/",
  "data/traffic-validation/derived/",
  "data/traffic-validation/runs/",
] as const;

export function normalizeSnapshot(input: TrafficSnapshot): TrafficSnapshot {
  return {
    ...input,
    segments: input.segments.map((segment) => ({
      ...segment,
      geometry: segment.geometry.map(([lng, lat]) => [Number(lng), Number(lat)]),
    })),
    incidents: input.incidents.map((incident) => ({
      ...incident,
      geometry: incident.geometry?.map(([lng, lat]) => [Number(lng), Number(lat)]),
    })),
  };
}

export function buildValidationResult(
  snapshot: TrafficSnapshot,
  modelRunId: string,
  scenarioId: string,
  metrics: ValidationMetric[],
  notes?: string,
): ValidationResult {
  const accepted = metrics.every((metric) => Math.abs(metric.delta) <= 0.15);
  return {
    snapshotId: snapshot.requestId,
    modelRunId,
    scenarioId,
    provider: snapshot.provider,
    requestedAt: snapshot.requestedAt,
    accepted,
    metrics,
    notes,
  };
}

export function createMockSnapshot(provider: TrafficProvider): TrafficSnapshot {
  return normalizeSnapshot({
    provider,
    requestId: `${provider}-local-validation`,
    requestedAt: new Date().toISOString(),
    windowStart: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    windowEnd: new Date().toISOString(),
    bbox: [21.19, 45.73, 21.24, 45.77],
    corridor: "Timișoara core validation corridor",
    mode: "traffic",
    segments: [
      {
        segmentId: "corridor-1",
        roadName: "Central Corridor",
        geometry: [
          [21.205, 45.752],
          [21.209, 45.749],
          [21.214, 45.746],
        ],
        speedKph: 28,
        travelTimeSeconds: 210,
        delaySeconds: 35,
        congestionLevel: "moderate",
        confidence: 0.82,
      },
    ],
    incidents: [
      {
        incidentId: `${provider}-incident-1`,
        kind: "slowdown",
        description: "Synthetic validation slowdown",
        severity: 2,
      },
    ],
    rawStored: false,
  });
}

type StptLiveVehicle = {
  id: string;
  route: string;
  lat: number;
  lng: number;
  bearing?: number;
  speed?: number;
  directionId?: string;
  headsign?: string;
  stop?: string;
  timestamp?: number;
  isAccessible?: boolean;
};

type RoadClosureRecord = {
  url: string;
  title: string;
  publishedAt: string;
  text?: string;
  highlights?: string[];
  roads?: string[];
  keptLocal?: boolean;
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function createTimisoaraStptAdapter(): TrafficProviderAdapter {
  return {
    provider: "timisoara-stpt",
    supportsRawCaching: true,
    async fetchSnapshot(request) {
      const latest = await readJson<{
        collectedAt: string;
        vehicleCount: number;
        routeCount: number;
        vehicles: StptLiveVehicle[];
      }>("/data/sources/stpt-live/latest-vehicles.json");

      const segments = latest.vehicles.slice(0, 25).map((vehicle, index) => {
        const speed = vehicle.speed ?? 0;
        const congestionLevel: TrafficSegmentSnapshot["congestionLevel"] =
          speed === 0 ? "severe" : speed < 10 ? "heavy" : speed < 20 ? "moderate" : "low";
        return {
          segmentId: `stpt-${vehicle.id}-${index}`,
          roadName: vehicle.headsign ?? vehicle.route,
          geometry: [
            [vehicle.lng - 0.001, vehicle.lat - 0.001],
            [vehicle.lng, vehicle.lat],
            [vehicle.lng + 0.001, vehicle.lat + 0.001],
          ] as [number, number][],
          speedKph: speed,
          travelTimeSeconds: speed > 0 ? Math.round(1800 / speed) : undefined,
          delaySeconds: speed === 0 ? 60 : Math.max(0, 30 - speed),
          congestionLevel,
          confidence: 0.72,
        };
      });

      return normalizeSnapshot({
        provider: "timisoara-stpt",
        requestId: request.requestId,
        requestedAt: request.requestedAt,
        windowStart: request.windowStart,
        windowEnd: request.windowEnd,
        bbox: request.bbox,
        corridor: request.corridor ?? "Timișoara transit probe layer",
        mode: request.mode ?? "transit-probe",
        segments,
        incidents: [],
        rawStored: false,
      });
    },
  };
}

export function createTimisoaraClosuresAdapter(): TrafficProviderAdapter {
  return {
    provider: "timisoara-closures",
    supportsRawCaching: true,
    async fetchSnapshot(request) {
      const latest = await readJson<{
        collectedAt: string;
        recordCount: number;
        records: RoadClosureRecord[];
      }>("/data/sources/timisoara-road-closures/latest.json");

      const activeRecords = latest.records.filter((record) => record.keptLocal !== false).slice(0, 20);
      const segments = activeRecords.flatMap((record, index) =>
        (record.roads ?? []).map((road, roadIndex) => ({
          segmentId: `closure-${index}-${roadIndex}`,
          roadName: road,
          geometry: [
            [request.bbox[0] + 0.001 * roadIndex, request.bbox[1] + 0.001 * index],
            [request.bbox[2] - 0.001 * roadIndex, request.bbox[3] - 0.001 * index],
          ] as [number, number][],
          speedKph: 0,
          travelTimeSeconds: undefined,
          delaySeconds: 120,
          congestionLevel: "severe" as const,
          confidence: 0.88,
        })),
      );

      return normalizeSnapshot({
        provider: "timisoara-closures",
        requestId: request.requestId,
        requestedAt: request.requestedAt,
        windowStart: request.windowStart,
        windowEnd: request.windowEnd,
        bbox: request.bbox,
        corridor: request.corridor ?? "Timișoara closure layer",
        mode: request.mode ?? "restriction",
        segments,
        incidents: activeRecords.slice(0, 12).map((record, index) => ({
          incidentId: `closure-${index}`,
          kind: "closure",
          description: record.title,
          severity: 3,
        })),
        rawStored: false,
      });
    },
  };
}

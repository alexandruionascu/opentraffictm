export type TrafficPhaseState = "green" | "red" | "unknown";

export type ConfidenceLevel = "high" | "medium" | "low" | "insufficient";

export interface TrafficLightLocation {
  id: string;
  name: string;
  lng: number;
  lat: number;
  osmId?: number;
  headingDeg?: number;
  sampleCount?: number;
}

export interface TrafficGpsObservation {
  vehicleId: string;
  routeId: string;
  directionId?: string;
  timestamp: number;
  lat: number;
  lon: number;
  speedKph?: number;
  stopName?: string;
  headsign?: string;
  sourceFile?: string;
}

export interface TrafficVehicleTrace {
  id: string;
  vehicleId: string;
  routeId: string;
  directionId?: string;
  observations: TrafficGpsObservation[];
}

export interface TrafficStopLocation {
  name: string;
  lng: number;
  lat: number;
  sampleCount: number;
}

export interface DetectedStopWindow {
  startIndex: number;
  endIndex: number;
  startTimestamp: number;
  endTimestamp: number;
  durationSeconds: number;
  centroid: { lng: number; lat: number };
  meanSpeedKph: number;
  minDistanceToLightMeters: number;
  nearestBusStopDistanceMeters: number;
  busStopNearby: boolean;
}

export interface TrafficHourlyStateSlice {
  hourOfDay: number;
  sampleCount: number;
  greenProbability: number;
  redProbability: number;
  confidence: number;
  phaseOffsetSeconds: number;
  greenDurationSeconds: number;
}

export interface TrafficCycleLengthCandidate {
  cycleLengthSeconds: number;
  confidence: number;
  sampleCount: number;
}

export interface TrafficPhaseOffsetCandidate {
  offsetSeconds: number;
  confidence: number;
  source: string;
}

export interface TrafficLightEvidencePath {
  lightId: string;
  routeKey: string;
  routeId: string;
  directionId?: string;
  approachHeadingDeg: number;
  points?: Array<{ lat: number; lon: number }>;
  passCount: number;
  stopPassCount: number;
  greenPassCount: number;
  redPassCount: number;
  confidence: number;
}

export interface TrafficLightPass {
  lightId: string;
  vehicleId: string;
  routeId: string;
  directionId?: string;
  crossingTimestamp: number;
  approachHeadingDeg: number;
  minDistanceToLightMeters: number;
  stoppedBeforeLight: boolean;
  stopDurationSeconds: number;
  greenStartTimestamp?: number;
  passState: TrafficPhaseState;
  busStopNearby: boolean;
  confidence: number;
  note: string;
}

export interface TrafficLightEstimate {
  lightId: string;
  cycleLengthSeconds: number;
  greenDurationSeconds: number;
  redDurationSeconds: number;
  phaseOffsetSeconds: number;
  offsetDriftSecondsPerHour?: number;
  anchorTimestamp: number;
  currentState: "green" | "red" | "unknown";
  timeUntilTransitionSeconds: number;
  confidence: number;
  bayesianConfidence?: number;
  hmmConfidence?: number;
  dtwAlignmentScore?: number;
  particleSpreadSeconds?: number;
  kalmanConfidence?: number;
  methodAgreementScore?: number;
  temporalStabilityScore?: number;
  hourlyProfile?: TrafficHourlyStateSlice[];
  passCount: number;
  routeCount: number;
  greenPassCount: number;
  redPassCount: number;
  stopPassCount: number;
  greenStartCount: number;
  cycleConfidence: number;
  phaseSeparationScore: number;
  cycleLengthDistribution?: TrafficCycleLengthCandidate[];
  phaseOffsetDistribution?: TrafficPhaseOffsetCandidate[];
  neighborSupportCount: number;
  syncAdjustmentSeconds: number;
  explanation: string;
  evidenceSummary: string[];
  pipelineStages: Array<{
    id: string;
    title: string;
    detail: string;
    done: boolean;
  }>;
}

export interface TrafficLightDataset {
  loadedAt: string;
  sourceFiles: string[];
  lights: TrafficLightLocation[];
  traces: TrafficVehicleTrace[];
  inferenceTraces?: TrafficVehicleTrace[];
  busStops: TrafficStopLocation[];
  evidencePathsByLightId?: Record<string, TrafficLightEvidencePath[]>;
}

export interface PrecomputedTrafficLightDataset extends TrafficLightDataset {
  estimates: TrafficLightEstimate[];
  passCount: number;
  passCountsByLightId: Record<string, number>;
}

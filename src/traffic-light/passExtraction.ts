import { bearingDegrees, haversineMeters } from "./mapMatching";
import { detectStopWindows } from "./stopDetection";
import type {
  TrafficGpsObservation,
  TrafficLightLocation,
  TrafficLightPass,
  TrafficStopLocation,
  TrafficVehicleTrace,
} from "./types";

function classifyPass(
  observations: TrafficGpsObservation[],
  light: TrafficLightLocation,
  busStops: TrafficStopLocation[],
): TrafficLightPass | null {
  const nearby = observations
    .map((observation) => ({
      observation,
      distanceMeters: haversineMeters({ lng: observation.lon, lat: observation.lat }, { lng: light.lng, lat: light.lat }),
    }))
    .filter((item) => item.distanceMeters <= 120)
    .sort((a, b) => a.observation.timestamp - b.observation.timestamp);

  if (nearby.length < 3) {
    return null;
  }

  const closest = nearby.reduce((best, item) => (item.distanceMeters < best.distanceMeters ? item : best), nearby[0]);
  const startPoint = nearby[0].observation;
  const endPoint = nearby[nearby.length - 1].observation;
  const crossingTimestamp = closest.observation.timestamp;
  const approachHeadingDeg = bearingDegrees(
    { lng: startPoint.lon, lat: startPoint.lat },
    { lng: endPoint.lon, lat: endPoint.lat },
  );
  const stopWindows = detectStopWindows(observations, light, busStops).filter(
    (window) => window.endTimestamp <= crossingTimestamp && window.durationSeconds >= 8,
  );
  const stopWindow = stopWindows[stopWindows.length - 1];
  const busStopPenalty =
    stopWindow && stopWindow.busStopNearby && stopWindow.minDistanceToLightMeters > 36 ? 0.35 : 0;
  const evidenceStrength = Math.min(1, nearby.length / 7);
  const speedSample = typeof closest.observation.speedKph === "number" ? closest.observation.speedKph : undefined;
  const slowedDown = typeof speedSample === "number" && speedSample < 6;
  const stoppedBeforeLight = Boolean(stopWindow) && stopWindow.durationSeconds >= 8 && busStopPenalty < 0.3;
  const passState = stoppedBeforeLight ? "red" : slowedDown ? "green" : "green";
  const greenStartTimestamp = stoppedBeforeLight ? stopWindow.endTimestamp + 1_000 : undefined;
  const confidence = Math.max(
    0.12,
    Math.min(
      0.98,
      0.36 +
        evidenceStrength * 0.32 +
        (stoppedBeforeLight ? 0.2 : 0.08) -
        busStopPenalty -
        Math.min(0.12, Math.max(0, closest.distanceMeters - 20) / 500),
    ),
  );

  return {
    lightId: light.id,
    vehicleId: startPoint.vehicleId,
    routeId: startPoint.routeId,
    directionId: startPoint.directionId,
    crossingTimestamp,
    approachHeadingDeg,
    minDistanceToLightMeters: closest.distanceMeters,
    stoppedBeforeLight,
    stopDurationSeconds: stopWindow?.durationSeconds ?? 0,
    greenStartTimestamp,
    passState,
    busStopNearby: Boolean(stopWindow?.busStopNearby),
    confidence,
    note: stoppedBeforeLight
      ? busStopPenalty > 0
        ? "Stopped, but the dwell point is also close to a known transit stop, so the classifier keeps a lower confidence."
        : "Low-speed dwell upstream of the light and away from a known bus stop, so the pass is classified as red."
      : slowedDown
        ? "The vehicle slowed, but not enough to look like a full queueing stop, so the pass is treated as green."
        : "The vehicle crossed without a stop cluster, so the pass is treated as green.",
  };
}

export function extractTrafficLightPasses(
  lights: TrafficLightLocation[],
  traces: TrafficVehicleTrace[],
  busStops: TrafficStopLocation[],
) {
  const passes: TrafficLightPass[] = [];

  for (const trace of traces) {
    const observations = trace.observations.slice().sort((a, b) => a.timestamp - b.timestamp);
    if (observations.length < 3) {
      continue;
    }

    for (const light of lights) {
      const pass = classifyPass(observations, light, busStops);
      if (pass) {
        passes.push(pass);
      }
    }
  }

  return passes;
}


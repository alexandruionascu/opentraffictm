import { angleDifferenceDegrees, bearingDegrees, haversineMeters } from "./mapMatching";
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
    (window) =>
      window.endTimestamp <= crossingTimestamp &&
      crossingTimestamp - window.endTimestamp <= 180_000 &&
      window.durationSeconds >= 8,
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
      0.3 +
        evidenceStrength * 0.24 +
        (stoppedBeforeLight ? 0.26 : slowedDown ? 0.06 : 0.02) -
        busStopPenalty -
        Math.min(0.22, Math.max(0, closest.distanceMeters - 20) / 320),
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

function splitCrossingClusters(
  observations: TrafficGpsObservation[],
  light: TrafficLightLocation,
  radiusMeters = 120,
) {
  const nearby = observations
    .map((observation, index) => ({
      observation,
      index,
      distanceMeters: haversineMeters({ lng: observation.lon, lat: observation.lat }, { lng: light.lng, lat: light.lat }),
    }))
    .filter((item) => item.distanceMeters <= radiusMeters)
    .sort((a, b) => a.observation.timestamp - b.observation.timestamp);

  const clusters: typeof nearby[] = [];
  for (const item of nearby) {
    const previousCluster = clusters[clusters.length - 1];
    const previous = previousCluster?.[previousCluster.length - 1];
    if (!previous || item.observation.timestamp - previous.observation.timestamp > 180_000) {
      clusters.push([item]);
    } else {
      previousCluster.push(item);
    }
  }

  return clusters.filter((cluster) => cluster.length >= 3);
}

function classifyPassCluster(
  observations: TrafficGpsObservation[],
  light: TrafficLightLocation,
  busStops: TrafficStopLocation[],
  cluster: ReturnType<typeof splitCrossingClusters>[number],
) {
  const firstIndex = cluster[0].index;
  const lastIndex = cluster[cluster.length - 1].index;
  const context = observations.slice(Math.max(0, firstIndex - 18), Math.min(observations.length, lastIndex + 19));
  return classifyPass(context, light, busStops);
}

function sameVehicleEvent(a: TrafficLightPass, b: TrafficLightPass) {
  return (
    a.vehicleId === b.vehicleId &&
    a.routeId === b.routeId &&
    (a.directionId ?? "") === (b.directionId ?? "") &&
    Math.abs(a.crossingTimestamp - b.crossingTimestamp) <= 45_000
  );
}

function passLightDistanceMeters(
  pass: TrafficLightPass,
  other: TrafficLightPass,
  lightsById: Map<string, TrafficLightLocation>,
) {
  const a = lightsById.get(pass.lightId);
  const b = lightsById.get(other.lightId);
  if (!a || !b) {
    return Number.POSITIVE_INFINITY;
  }
  return haversineMeters({ lng: a.lng, lat: a.lat }, { lng: b.lng, lat: b.lat });
}

function headingFit(pass: TrafficLightPass, light: TrafficLightLocation) {
  if (typeof light.headingDeg !== "number") {
    return 0.5;
  }

  const forward = angleDifferenceDegrees(pass.approachHeadingDeg, light.headingDeg);
  const reverse = angleDifferenceDegrees(pass.approachHeadingDeg, light.headingDeg + 180);
  return 1 - Math.min(forward, reverse) / 180;
}

function representativeScore(pass: TrafficLightPass, light: TrafficLightLocation | undefined) {
  return (
    pass.confidence * 100 +
    (pass.stoppedBeforeLight ? 18 : 0) +
    (light ? headingFit(pass, light) * 12 : 0) -
    Math.min(45, pass.minDistanceToLightMeters * 0.58)
  );
}

function selectRepresentativePasses(
  candidates: TrafficLightPass[],
  lightsById: Map<string, TrafficLightLocation>,
) {
  const selected: TrafficLightPass[] = [];
  const ranked = candidates
    .slice()
    .sort(
      (a, b) =>
        representativeScore(b, lightsById.get(b.lightId)) -
          representativeScore(a, lightsById.get(a.lightId)) ||
        a.crossingTimestamp - b.crossingTimestamp,
    );

  for (const pass of ranked) {
    const duplicate = selected.some(
      (existing) =>
        sameVehicleEvent(pass, existing) &&
        passLightDistanceMeters(pass, existing, lightsById) <= 75,
    );
    if (!duplicate) {
      selected.push(pass);
    }
  }

  return selected.sort((a, b) => a.crossingTimestamp - b.crossingTimestamp);
}

function lightCellKey(lat: number, lng: number, cellSize: number) {
  return `${Math.floor(lat / cellSize)}:${Math.floor(lng / cellSize)}`;
}

function buildLightIndex(lights: TrafficLightLocation[], cellSize = 0.002) {
  const index = new Map<string, TrafficLightLocation[]>();
  for (const light of lights) {
    const key = lightCellKey(light.lat, light.lng, cellSize);
    const bucket = index.get(key) ?? [];
    bucket.push(light);
    index.set(key, bucket);
  }
  return { index, cellSize };
}

function findCandidateLights(
  observations: TrafficGpsObservation[],
  lightsByCell: Map<string, TrafficLightLocation[]>,
  cellSize: number,
) {
  const candidates = new Map<string, TrafficLightLocation>();
  for (const observation of observations) {
    const latCell = Math.floor(observation.lat / cellSize);
    const lngCell = Math.floor(observation.lon / cellSize);
    for (let latOffset = -1; latOffset <= 1; latOffset += 1) {
      for (let lngOffset = -1; lngOffset <= 1; lngOffset += 1) {
        const bucket = lightsByCell.get(`${latCell + latOffset}:${lngCell + lngOffset}`) ?? [];
        for (const light of bucket) {
          if (
            !candidates.has(light.id) &&
            haversineMeters({ lng: observation.lon, lat: observation.lat }, { lng: light.lng, lat: light.lat }) <= 130
          ) {
            candidates.set(light.id, light);
          }
        }
      }
    }
  }
  return [...candidates.values()];
}

export function extractTrafficLightPasses(
  lights: TrafficLightLocation[],
  traces: TrafficVehicleTrace[],
  busStops: TrafficStopLocation[],
) {
  const passes: TrafficLightPass[] = [];
  const { index: lightsByCell, cellSize } = buildLightIndex(lights);
  const lightsById = new Map(lights.map((light) => [light.id, light] as const));

  for (const trace of traces) {
    const observations = trace.observations.slice().sort((a, b) => a.timestamp - b.timestamp);
    if (observations.length < 3) {
      continue;
    }

    const traceCandidates: TrafficLightPass[] = [];
    for (const light of findCandidateLights(observations, lightsByCell, cellSize)) {
      const clusters = splitCrossingClusters(observations, light);
      for (const cluster of clusters) {
        const pass = classifyPassCluster(observations, light, busStops, cluster);
        if (pass) {
          traceCandidates.push(pass);
        }
      }
    }

    passes.push(...selectRepresentativePasses(traceCandidates, lightsById));
  }

  return passes;
}

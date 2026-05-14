import { haversineMeters } from "./mapMatching";
import type {
  DetectedStopWindow,
  TrafficGpsObservation,
  TrafficLightLocation,
  TrafficStopLocation,
} from "./types";

function isLowSpeed(observation: TrafficGpsObservation, previous?: TrafficGpsObservation, next?: TrafficGpsObservation) {
  if (typeof observation.speedKph === "number" && Number.isFinite(observation.speedKph)) {
    return observation.speedKph < 2;
  }

  if (!previous || !next) {
    return false;
  }

  const distanceMeters = haversineMeters(
    { lng: previous.lon, lat: previous.lat },
    { lng: next.lon, lat: next.lat },
  );
  const durationSeconds = Math.max(1, (next.timestamp - previous.timestamp) / 1000);
  const inferredSpeedKph = (distanceMeters / durationSeconds) * 3.6;
  return inferredSpeedKph < 2;
}

export function detectStopWindows(
  observations: TrafficGpsObservation[],
  light: TrafficLightLocation,
  busStops: TrafficStopLocation[],
): DetectedStopWindow[] {
  const points = observations.slice().sort((a, b) => a.timestamp - b.timestamp);
  const windows: DetectedStopWindow[] = [];
  let index = 0;

  while (index < points.length) {
    const current = points[index];
    const previous = points[index - 1];
    const next = points[index + 1];
    if (!isLowSpeed(current, previous, next)) {
      index += 1;
      continue;
    }

    let endIndex = index;
    while (endIndex + 1 < points.length) {
      const candidate = points[endIndex + 1];
      const candidateNext = points[endIndex + 2];
      if (!isLowSpeed(candidate, points[endIndex], candidateNext)) {
        break;
      }
      endIndex += 1;
    }

    const segment = points.slice(index, endIndex + 1);
    const durationSeconds = (segment[segment.length - 1].timestamp - segment[0].timestamp) / 1000;
    const meanSpeedKph =
      segment.reduce((total, point) => total + (typeof point.speedKph === "number" ? point.speedKph : 0), 0) /
      Math.max(1, segment.length);
    const centroid = {
      lng: segment.reduce((total, point) => total + point.lon, 0) / segment.length,
      lat: segment.reduce((total, point) => total + point.lat, 0) / segment.length,
    };
    const minDistanceToLightMeters = Math.min(
      ...segment.map((point) => haversineMeters({ lng: point.lon, lat: point.lat }, { lng: light.lng, lat: light.lat })),
    );
    const nearestBusStopDistanceMeters = busStops.length
      ? Math.min(
          ...busStops.map((stop) =>
            haversineMeters({ lng: stop.lng, lat: stop.lat }, { lng: centroid.lng, lat: centroid.lat }),
          ),
        )
      : Number.POSITIVE_INFINITY;

    windows.push({
      startIndex: index,
      endIndex,
      startTimestamp: segment[0].timestamp,
      endTimestamp: segment[segment.length - 1].timestamp,
      durationSeconds,
      centroid,
      meanSpeedKph,
      minDistanceToLightMeters,
      nearestBusStopDistanceMeters,
      busStopNearby: nearestBusStopDistanceMeters <= 28,
    });

    index = endIndex + 1;
  }

  return windows;
}


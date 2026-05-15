import type { TrafficGpsObservation, TrafficLightLocation } from "./types";

export function haversineMeters(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const earthRadiusMeters = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const value =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function bearingDegrees(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

export function normalizeAngleDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

export function angleDifferenceDegrees(a: number, b: number) {
  const diff = Math.abs(normalizeAngleDegrees(a) - normalizeAngleDegrees(b));
  return diff > 180 ? 360 - diff : diff;
}

export function modulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

export function circularMean(values: number[], period: number) {
  if (!values.length || period <= 0) {
    return 0;
  }

  let x = 0;
  let y = 0;
  for (const value of values) {
    const angle = (2 * Math.PI * modulo(value, period)) / period;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }

  return modulo((Math.atan2(y, x) * period) / (2 * Math.PI), period);
}

export function circularConcentration(values: number[], period: number) {
  if (values.length < 2 || period <= 0) {
    return 0;
  }

  let x = 0;
  let y = 0;
  for (const value of values) {
    const angle = (2 * Math.PI * modulo(value, period)) / period;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }

  return Math.sqrt(x * x + y * y) / values.length;
}

export function circularDistance(a: number, b: number, period: number) {
  const raw = Math.abs(modulo(a, period) - modulo(b, period));
  return Math.min(raw, period - raw);
}

export function getTraceBounds(points: Array<{ lng: number; lat: number }>) {
  if (!points.length) {
    return null;
  }

  return points.reduce<[number, number, number, number]>(
    (acc, point) => [
      Math.min(acc[0], point.lng),
      Math.min(acc[1], point.lat),
      Math.max(acc[2], point.lng),
      Math.max(acc[3], point.lat),
    ],
    [points[0].lng, points[0].lat, points[0].lng, points[0].lat] as [number, number, number, number],
  );
}

export function sampleTrace(points: TrafficGpsObservation[], maxPoints: number) {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index % step === 0);
}

export function findClosestLight(
  observation: TrafficGpsObservation,
  lights: TrafficLightLocation[],
  radiusMeters = 120,
) {
  let best: { light: TrafficLightLocation; distanceMeters: number } | null = null;
  for (const light of lights) {
    const distanceMeters = haversineMeters(
      { lng: observation.lon, lat: observation.lat },
      { lng: light.lng, lat: light.lat },
    );
    if (distanceMeters > radiusMeters) {
      continue;
    }

    if (!best || distanceMeters < best.distanceMeters) {
      best = { light, distanceMeters };
    }
  }

  return best;
}


import Database from "better-sqlite3";

const DB_PATH = "data/stpt.db";
const NOMINAL_BUS_SPEED_KPH = 18;

export interface ProbeSegment {
  route: string;
  vehicleId: string;
  speedKph: number;
  distanceMeters: number;
  timeDeltaSeconds: number;
  delaySeconds: number;
  geometry: [number, number][];
}

export interface ProbeRouteStats {
  route: string;
  sampleCount: number;
  avgSpeedKph: number;
  minSpeedKph: number;
  maxSpeedKph: number;
  avgDelaySeconds: number;
  totalDistanceMeters: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeDelay(speedKph: number): number {
  if (speedKph <= 0) return 60;
  return Math.max(0, NOMINAL_BUS_SPEED_KPH - speedKph) * 3.6;
}

function openDb(): Database {
  return new Database(DB_PATH, { readonly: true });
}

export function queryProbeSegments(
  db: Database,
  route?: string,
  windowSeconds = 300
): ProbeSegment[] {
  const cutoff = Date.now() - windowSeconds * 1000;
  const cutoffDate = new Date(cutoff).toISOString();

  let sql = `
    WITH paired AS (
      SELECT
        id, route, lat, lng, speed, server_timestamp,
        LAG(lat)    OVER (PARTITION BY id ORDER BY server_timestamp) as prev_lat,
        LAG(lng)    OVER (PARTITION BY id ORDER BY server_timestamp) as prev_lng,
        LAG(server_timestamp) OVER (PARTITION BY id ORDER BY server_timestamp) as prev_ts
      FROM vehicle_positions
      WHERE recorded_at >= ?
        AND server_timestamp IS NOT NULL
        AND lat IS NOT NULL AND lng IS NOT NULL
        ${route ? "AND route = ?" : ""}
    )
    SELECT
      id, route,
      printf('%.6f', lat) as lat,
      printf('%.6f', lng) as lng,
      printf('%.6f', prev_lat) as prev_lat,
      printf('%.6f', prev_lng) as prev_lng,
      speed,
      server_timestamp,
      prev_ts,
      (server_timestamp - prev_ts) / 1000.0 as time_delta_sec
    FROM paired
    WHERE prev_lat IS NOT NULL
      AND prev_lng IS NOT NULL
      AND prev_ts IS NOT NULL
      AND time_delta_sec > 0
      AND time_delta_sec < 60
  `;

  const params = route ? [cutoffDate, route] : [cutoffDate];
  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    route: string;
    lat: string;
    lng: string;
    prev_lat: string;
    prev_lng: string;
    speed: number | null;
    server_timestamp: number;
    prev_ts: number;
    time_delta_sec: number;
  }>;

  return rows
    .map((row) => {
      const lat = parseFloat(row.lat);
      const lng = parseFloat(row.lng);
      const prevLat = parseFloat(row.prev_lat);
      const prevLng = parseFloat(row.prev_lng);
      const dist = haversineDistanceMeters(prevLat, prevLng, lat, lng);
      const timeDelta = row.time_delta_sec;
      const speedKph = (dist / timeDelta) * 3.6;

      return {
        route: row.route,
        vehicleId: row.id,
        speedKph: Math.max(0, speedKph),
        distanceMeters: dist,
        timeDeltaSeconds: timeDelta,
        delaySeconds: computeDelay(speedKph),
        geometry: [
          [prevLng, prevLat],
          [lng, lat],
        ] as [number, number][],
      };
    })
    .filter((s) => s.distanceMeters > 1);
}

export function queryRouteStats(
  db: Database,
  windowSeconds = 300
): ProbeRouteStats[] {
  const segments = queryProbeSegments(db, undefined, windowSeconds);
  const byRoute = new Map<string, ProbeSegment[]>();
  for (const seg of segments) {
    const list = byRoute.get(seg.route) ?? [];
    list.push(seg);
    byRoute.set(seg.route, list);
  }

  return Array.from(byRoute.entries())
    .map(([route, segs]) => {
      const speeds = segs.map((s) => s.speedKph);
      const delays = segs.map((s) => s.delaySeconds);
      const distances = segs.map((s) => s.distanceMeters);
      return {
        route,
        sampleCount: segs.length,
        avgSpeedKph: speeds.reduce((a, b) => a + b, 0) / speeds.length,
        minSpeedKph: Math.min(...speeds),
        maxSpeedKph: Math.max(...speeds),
        avgDelaySeconds: delays.reduce((a, b) => a + b, 0) / delays.length,
        totalDistanceMeters: distances.reduce((a, b) => a + b, 0),
      };
    })
    .sort((a, b) => b.sampleCount - a.sampleCount);
}

export function getRecentProbeStats(windowSeconds = 300): ProbeRouteStats[] {
  const db = openDb();
  try {
    return queryRouteStats(db, windowSeconds);
  } finally {
    db.close();
  }
}

export function getRecentProbeSegments(
  route?: string,
  windowSeconds = 300
): ProbeSegment[] {
  const db = openDb();
  try {
    return queryProbeSegments(db, route, windowSeconds);
  } finally {
    db.close();
  }
}
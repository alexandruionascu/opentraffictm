const DB_PATH = "stpt.db";
const NOMINAL_BUS_SPEED_KPH = 18;

export interface ProbeSegment {
  route: string;
  vehicleId: string;
  speedKph: number;
  distanceMeters: number;
  timeDeltaSeconds: number;
  delaySeconds: number;
  serverTimestamp: number;
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

async function openDb() {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(DB_PATH, { readonly: true });
}

async function queryProbeSegmentsInternal(
  db: { prepare<T>(sql: string): { all(...params: unknown[]): T[]; get(...params: unknown[]): T }; close(): void },
  route: string | undefined,
  windowSeconds: number | null
): Promise<ProbeSegment[]> {
  const timeFilter = windowSeconds !== null
    ? "AND server_timestamp >= ?"
    : "";
  const params = windowSeconds !== null
    ? [String(Date.now() - windowSeconds * 1000), ...(route ? [route] : [])]
    : route ? [route] : [];

  const sql = `
    WITH paired AS (
      SELECT
        id, route, lat, lng, speed, server_timestamp,
        LAG(lat)    OVER (PARTITION BY id ORDER BY server_timestamp) as prev_lat,
        LAG(lng)    OVER (PARTITION BY id ORDER BY server_timestamp) as prev_lng,
        LAG(server_timestamp) OVER (PARTITION BY id ORDER BY server_timestamp) as prev_ts
      FROM vehicle_positions
      WHERE server_timestamp IS NOT NULL
        AND lat IS NOT NULL AND lng IS NOT NULL
        ${timeFilter}
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

  const rows = (route ? db.prepare(sql).all(...params) : db.prepare(sql).all(...params)) as Array<{
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
        serverTimestamp: row.server_timestamp,
        geometry: [
          [prevLng, prevLat],
          [lng, lat],
        ] as [number, number][],
      };
    })
    .filter((s) => s.distanceMeters > 1);
}

export async function queryProbeSegments(
  route?: string,
  windowSeconds = 300
): Promise<ProbeSegment[]> {
  if (typeof window !== "undefined") return [];
  const db = await openDb();
  try {
    return queryProbeSegmentsInternal(db, route, windowSeconds);
  } finally {
    db.close();
  }
}

export async function queryAllProbeSegments(
  route?: string
): Promise<ProbeSegment[]> {
  if (typeof window !== "undefined") return [];
  const db = await openDb();
  try {
    return queryProbeSegmentsInternal(db, route, null);
  } finally {
    db.close();
  }
}

export async function queryRouteStats(
  windowSeconds = 300
): Promise<ProbeRouteStats[]> {
  const segments = await queryProbeSegments(undefined, windowSeconds);
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

export async function getRecentProbeSegments(
  route?: string,
  windowSeconds = 300
): Promise<ProbeSegment[]> {
  return queryProbeSegments(route, windowSeconds);
}

export async function getAllProbeSegments(
  route?: string
): Promise<ProbeSegment[]> {
  return queryAllProbeSegments(route);
}

export async function getRecentProbeStats(
  windowSeconds = 300
): Promise<ProbeRouteStats[]> {
  return queryRouteStats(windowSeconds);
}
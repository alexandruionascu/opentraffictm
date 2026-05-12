import type { Feature, FeatureCollection, LineString } from "geojson";

export interface ClosureRecord {
  url: string;
  title: string;
  publishedAt: string | null;
  source: string;
  text: string;
  highlights: string[];
  roads: string[];
  keptLocal: boolean;
}

export interface ClosureManifest {
  collectedAt: string;
  source: string;
  sourceType: string;
  retainedLocally: boolean;
  recordCount: number;
  failures: Array<{ url: string; error: string }>;
  records: ClosureRecord[];
}

export type ClosureStatus = "active" | "scheduled" | "recently-cleared" | "expired";

export interface ClosureOverlayProperties {
  closureId: string;
  noticeTitle: string;
  noticeUrl: string;
  roadName: string;
  roadHint: string;
  status: ClosureStatus;
  statusLabel: string;
  publishedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
}

export interface ClosureOverlaySummary {
  active: number;
  scheduled: number;
  recentlyCleared: number;
  expired: number;
  total: number;
}

export interface ClosureOverlayResult {
  features: Feature<LineString, ClosureOverlayProperties>[];
  summary: ClosureOverlaySummary;
}

const ROAD_PREFIX_RE =
  /^(strada|str\.|str|bulevardul|bulevard|bd\.|b-dul|calea|splaiul|splai|podul|pod|piata|piața|aleea|intrarea|drumul|drum)\s+/i;

const DATE_RANGE_RE = /(\d{2}\.\d{2}\.\d{4})(?:\s*[–-]\s*(\d{2}\.\d{2}\.\d{4}))?/g;

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export function normalizeClosureText(value: string) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedRoadVariants(name: string) {
  const cleaned = normalizeClosureText(name);
  const stripped = cleaned.replace(ROAD_PREFIX_RE, "").trim();
  return new Set([cleaned, stripped].filter(Boolean));
}

function parseRomanianDate(dateText: string) {
  const [day, month, year] = dateText.split(".").map((part) => Number(part));
  if (!day || !month || !year) return null;
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
}

function formatDate(value: Date | null) {
  if (!value) return null;
  return value.toISOString();
}

function extractWindows(text: string) {
  DATE_RANGE_RE.lastIndex = 0;
  const windows: Array<{ start: Date; end: Date }> = [];
  let match: RegExpExecArray | null;

  while ((match = DATE_RANGE_RE.exec(text))) {
    const start = parseRomanianDate(match[1]);
    const end = parseRomanianDate(match[2] ?? match[1]);
    if (start && end) {
      windows.push({ start, end });
    }
  }

  return windows;
}

export function getClosureStatus(record: ClosureRecord) {
  const windows = extractWindows(record.text);
  return classifyStatus(windows);
}

function classifyStatus(
  windows: Array<{ start: Date; end: Date }>,
  now = new Date(),
): { status: ClosureStatus; label: string; windowStart: Date | null; windowEnd: Date | null } {
  const today = startOfDay(now);
  if (!windows.length) {
    return {
      status: "expired",
      label: "status unavailable",
      windowStart: null,
      windowEnd: null,
    };
  }

  const sorted = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const active = sorted.find((window) => window.start <= today && today <= window.end);
  if (active) {
    return {
      status: "active",
      label: "closed now",
      windowStart: active.start,
      windowEnd: active.end,
    };
  }

  const next = sorted.find((window) => window.start > today);
  if (next) {
    return {
      status: "scheduled",
      label: "scheduled",
      windowStart: next.start,
      windowEnd: next.end,
    };
  }

  const recent = [...sorted].reverse().find((window) => {
    const daysSinceEnd = (today.getTime() - window.end.getTime()) / 86_400_000;
    return daysSinceEnd >= 0 && daysSinceEnd <= 21;
  });

  if (recent) {
    return {
      status: "recently-cleared",
      label: "recently cleared",
      windowStart: recent.start,
      windowEnd: recent.end,
    };
  }

  const latest = sorted[sorted.length - 1];
  return {
    status: "expired",
    label: "expired",
    windowStart: latest.start,
    windowEnd: latest.end,
  };
}

function matchesRoadName(roadName: string, searchText: string) {
  const variants = normalizedRoadVariants(roadName);
  for (const variant of variants) {
    if (!variant) continue;
    if (searchText.includes(variant) || variant.includes(searchText)) return true;
  }
  return false;
}

function pickRoadName(featureName: unknown) {
  if (typeof featureName !== "string") return null;
  const name = featureName.trim();
  return name.length ? name : null;
}

function roadSearchText(record: ClosureRecord) {
  return normalizeClosureText([record.title, record.text, ...record.roads].join(" "));
}

export function buildClosureOverlay(
  roads: FeatureCollection<LineString>,
  records: ClosureRecord[],
): ClosureOverlayResult {
  const features: Feature<LineString, ClosureOverlayProperties>[] = [];
  const summary: ClosureOverlaySummary = {
    active: 0,
    scheduled: 0,
    recentlyCleared: 0,
    expired: 0,
    total: 0,
  };

  const roadFeatures = roads.features.filter((feature) => pickRoadName(feature.properties?.name));
  const roadSearchCache = new Map<string, string>();

  for (const record of records) {
    const windows = extractWindows(record.text);
    const classified = classifyStatus(windows);
    summary.total += 1;
    if (classified.status === "active") summary.active += 1;
    if (classified.status === "scheduled") summary.scheduled += 1;
    if (classified.status === "recently-cleared") summary.recentlyCleared += 1;
    if (classified.status === "expired") summary.expired += 1;

    const searchText = roadSearchText(record);
    const matchedRoads = roadFeatures.filter((feature) => {
      const roadName = pickRoadName(feature.properties?.name);
      if (!roadName) return false;
      const cached = roadSearchCache.get(roadName) ?? normalizeClosureText(roadName);
      roadSearchCache.set(roadName, cached);
      return matchesRoadName(cached, searchText);
    });

    for (const feature of matchedRoads) {
      const roadName = pickRoadName(feature.properties?.name);
      if (!roadName) continue;
      features.push({
        type: "Feature",
        geometry: feature.geometry,
        properties: {
          closureId: `${record.url}:${roadName}`,
          noticeTitle: record.title,
          noticeUrl: record.url,
          roadName,
          roadHint: record.roads.join(" · "),
          status: classified.status,
          statusLabel: classified.label,
          publishedAt: record.publishedAt,
          windowStart: formatDate(classified.windowStart),
          windowEnd: formatDate(classified.windowEnd),
        },
      });
    }
  }

  return { features, summary };
}

export function sortClosureRecords(records: ClosureRecord[]) {
  const order: Record<ClosureStatus, number> = {
    active: 0,
    scheduled: 1,
    "recently-cleared": 2,
    expired: 3,
  };

  return [...records].sort((left, right) => {
    const leftClass = getClosureStatus(left);
    const rightClass = getClosureStatus(right);
    const statusDiff = order[leftClass.status] - order[rightClass.status];
    if (statusDiff !== 0) return statusDiff;
    return String(right.publishedAt ?? right.title).localeCompare(String(left.publishedAt ?? left.title));
  });
}

export function closureWindowLabel(record: ClosureRecord) {
  const windows = extractWindows(record.text);
  if (!windows.length) return "Date unavailable";

  const classified = classifyStatus(windows);
  const start = classified.windowStart ? classified.windowStart.toLocaleDateString("en-GB") : null;
  const end = classified.windowEnd ? classified.windowEnd.toLocaleDateString("en-GB") : null;

  if (!start || !end) return classified.label;
  return start === end ? start : `${start} to ${end}`;
}

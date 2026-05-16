import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "data", "map-views");
const GENERATED_AT = new Date().toISOString();
const TIMISOARA_CENTER = [21.2087, 45.7489];
const LARGE_ARTIFACT_WARN_BYTES = 1_500_000;

const paths = {
  tomtomLiveGeoJson: "data/traffic-live/tomtom-live-geojson.json",
  tomtomLive: "data/traffic-live/tomtom-latest.json",
  tomtomFlow: "data/traffic-flow/tomtom-latest.json",
  closures: "data/sources/timisoara-road-closures/latest.json",
  stptVehicles: "data/sources/stpt-live/latest-vehicles.geojson",
  stptSnapshot: "data/sources/stpt-live/latest-vehicles.json",
  stptStops: "data/sources/stpt-live/stations-index.json",
  osmRoads: "data/osm/timisoara-roads.geojson",
  osmControls: "data/osm/timisoara-controls.geojson",
  signals: "data/traffic-lights/signals.json",
  signalCandidates: "data/traffic-lights/analysis/intersection-analysis.json",
  probeAggregation: "data/derived/probe-aggregation.json",
  scenarios: "data/scenarios.json",
};

const pageCatalog = [
  ["live-transit", "Live Transit", "STPT", "data/map-views/stpt-live/vehicles.geojson", "Current STPT vehicles."],
  ["live-transit/routes", "Route Vehicles", "STPT", "data/map-views/stpt-live/vehicles-by-route/{route}.geojson", "Route-filtered vehicle snapshots."],
  ["live-transit/accessibility", "Accessible Vehicles", "STPT", "data/map-views/stpt-live/accessible.geojson", "Vehicle accessibility split."],
  ["live-transit/stops", "STPT Stops", "STPT", "data/map-views/stpt-live/stops.geojson", "Station and stop points."],
  ["live-transit/headsigns", "Headsign Clusters", "STPT", "data/map-views/stpt-live/vehicles.geojson", "Destination/headsign vehicle clusters."],
  ["tomtom-live", "TomTom Live Flow", "TomTom", "data/map-views/tomtom/latest-flow.geojson", "Latest live TomTom flow lines."],
  ["tomtom-timeslots", "TomTom Timeslots", "TomTom", "data/map-views/tomtom/timeslot-{slot}.geojson", "Time-of-day flow snapshots."],
  ["tomtom-morning-rush", "Morning Rush", "TomTom", "data/map-views/tomtom/timeslot-morning-rush.geojson", "Morning congestion."],
  ["tomtom-afternoon-rush", "Afternoon Rush", "TomTom", "data/map-views/tomtom/timeslot-afternoon-rush.geojson", "Afternoon congestion."],
  ["tomtom-evening", "Evening Congestion", "TomTom", "data/map-views/tomtom/timeslot-evening.geojson", "Evening congestion."],
  ["tomtom-severe", "Severe TomTom Segments", "TomTom", "data/map-views/tomtom/severe-heavy.geojson", "Heavy and blocked segments only."],
  ["tomtom-incidents", "TomTom Incidents", "TomTom", "data/map-views/tomtom/incidents.geojson", "Incident severity pins."],
  ["closures", "Road Restrictions", "Closures", "data/map-views/closures/all.geojson", "All matched municipal restrictions."],
  ["closures/active", "Active Restrictions", "Closures", "data/map-views/closures/active.geojson", "Restrictions active today."],
  ["closures/scheduled", "Scheduled Restrictions", "Closures", "data/map-views/closures/scheduled.geojson", "Future restrictions."],
  ["closures/recent", "Recently Cleared", "Closures", "data/map-views/closures/recent.geojson", "Recently cleared restrictions."],
  ["closures/events", "Event Closures", "Closures", "data/map-views/closures/events.geojson", "Event-style closure notices."],
  ["signals", "Signal Candidates", "Signals", "data/map-views/signals/candidates.geojson", "Signal candidates inferred from stops."],
  ["signals/provided", "Provided Signal Programs", "Signals", "data/map-views/signals/provided.geojson", "Provided and inferred programs."],
  ["signals/unmapped", "Unmapped OSM Signals", "Signals", "data/map-views/signals/unmapped-osm.geojson", "OSM signals without program data."],
  ["signals/stops", "Stop Hotspots", "Signals", "data/map-views/signals/stop-hotspots.geojson", "Stop/resume hotspots."],
  ["signals/confidence", "Signal Confidence", "Signals", "data/map-views/signals/confidence-{band}.geojson", "Candidate confidence bands."],
  ["transit-delay", "Transit Delay Corridors", "Transit Corridors", "data/map-views/transit/delay-corridors.geojson", "STPT route delay corridors."],
  ["transit-speed", "Transit Speed Corridors", "Transit Corridors", "data/map-views/transit/speed-corridors.geojson", "STPT route average speed corridors."],
  ["transit-samples", "Transit Sample Density", "Transit Corridors", "data/map-views/transit/sample-density.geojson", "STPT route sample-density corridors."],
  ["osm-roads", "Road Hierarchy", "OSM", "data/map-views/osm/roads-major.geojson,data/map-views/osm/roads-minor-simplified.geojson", "Road hierarchy split from OSM."],
  ["osm-major-roads", "Major Roads", "OSM", "data/map-views/osm/roads-major.geojson", "Major roads only."],
  ["osm-lanes", "Generated Lane Bands", "OSM", "data/map-views/osm/lane-bands.geojson", "Generated lane bands."],
  ["osm-controls", "Crossings And Signals", "OSM", "data/map-views/osm/traffic-signals.geojson,data/map-views/osm/crossings.geojson", "OSM crossings and traffic signals."],
  ["scenarios", "Scenario Geography", "Scenarios", "data/map-views/scenarios/catalog.geojson", "Scenario catalog geography."],
  ["scenarios/playback", "Scenario Playback", "Scenarios", "data/simulation-timelines/{scenario}.json", "Existing simulation playback view."],
  ["data-gaps", "Data Gaps", "Quality", "data/map-views/data-gaps/gaps.geojson", "Datasets that need better geometry or adapters."],
];

function readJson(relativePath, fallback = null) {
  const fullPath = join(ROOT, relativePath);
  if (!existsSync(fullPath)) return fallback;
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

function fc(features = []) {
  return { type: "FeatureCollection", features };
}

function roundCoord(value) {
  return Number(value.toFixed(6));
}

function cleanLineCoordinates(coordinates, keepEvery = 1) {
  const source = Array.isArray(coordinates) ? coordinates : [];
  const filtered = source.filter((_, index) => index === 0 || index === source.length - 1 || index % keepEvery === 0);
  return filtered.map((point) => [roundCoord(Number(point[0])), roundCoord(Number(point[1]))]);
}

function writeFeature(id, geometry, properties) {
  return {
    type: "Feature",
    id,
    geometry,
    properties: {
      id,
      label: properties.label ?? id,
      ...properties,
    },
  };
}

async function writeArtifact(relativePath, data, stats) {
  const fullPath = join(ROOT, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, `${JSON.stringify(data)}\n`);
  const fileStat = await stat(fullPath);
  const featureCount = data?.type === "FeatureCollection" ? data.features.length : null;
  stats.artifacts[relativePath] = {
    bytes: fileStat.size,
    featureCount,
    warning: fileStat.size > LARGE_ARTIFACT_WARN_BYTES ? "artifact exceeds expected compact map-view size" : null,
  };
  if (fileStat.size > LARGE_ARTIFACT_WARN_BYTES) {
    console.warn(`[map-views] large artifact ${relativePath}: ${Math.round(fileStat.size / 1024)} KB`);
  }
}

function congestionOrder(level) {
  return { low: 0, free: 0, light: 1, synchronized: 2, moderate: 2, heavy: 3, severe: 4, blocked: 4 }[String(level)] ?? 0;
}

function tomtomLineFeature(row, idPrefix) {
  const coords =
    row.coordinates?.map((point) => [point.lng, point.lat]) ??
    row.points?.map((point) => [point.lng, point.lat]) ??
    row.segment?.coordinates?.map((point) => [point.lng, point.lat]) ??
    null;
  if ((!coords || coords.length < 2) && (!Number.isFinite(Number(row.lng)) || !Number.isFinite(Number(row.lat)))) return null;
  const id = `${idPrefix}-${row.roadId ?? row.pointId ?? row.segmentIndex ?? row.probeKey ?? Math.random().toString(36).slice(2)}`;
  const speed = Number(row.speedKph ?? row.currentSpeedKph ?? row.speed ?? 0);
  const freeFlow = Number(row.freeFlowKph ?? row.freeFlowSpeedKph ?? row.freeFlow ?? 0);
  const delaySeconds = Number(row.delaySeconds ?? 0);
  const congestionLevel = String(row.congestionLevel ?? (freeFlow > 0 && speed / freeFlow < 0.45 ? "heavy" : "low"));
  return writeFeature(
    id,
    coords && coords.length >= 2
      ? { type: "LineString", coordinates: cleanLineCoordinates(coords, 1) }
      : { type: "Point", coordinates: [roundCoord(Number(row.lng)), roundCoord(Number(row.lat))] },
    {
      label: `${row.roadId ?? row.pointId ?? "TomTom segment"} · ${speed || "n/a"} km/h`,
      source: "TomTom",
      kind: "flow",
      speedKph: speed,
      freeFlowKph: freeFlow,
      speedRatio: freeFlow ? Number((speed / freeFlow).toFixed(3)) : null,
      delaySeconds: Number.isFinite(delaySeconds) ? Number(delaySeconds.toFixed(1)) : 0,
      congestionLevel,
      congestionRank: congestionOrder(congestionLevel),
      roadClosure: Boolean(row.roadClosure),
      confidence: Number(row.confidence ?? 0),
      frc: row.frc ?? null,
      collectedAt: row.collectedAt ?? null,
    },
  );
}

async function buildTomTom(stats) {
  const liveGeo = readJson(paths.tomtomLiveGeoJson, fc());
  const live = readJson(paths.tomtomLive, {});
  const flow = readJson(paths.tomtomFlow, {});
  const latestFlow = liveGeo.features.map((feature, index) =>
    writeFeature(
      `tomtom-live-${feature.properties?.roadId ?? index}`,
      { type: "LineString", coordinates: cleanLineCoordinates(feature.geometry?.coordinates ?? [], 1) },
      {
        label: `${feature.properties?.roadId ?? "TomTom road"} · ${feature.properties?.speed ?? "n/a"} km/h`,
        source: "TomTom live",
        kind: "flow",
        speedKph: Number(feature.properties?.speed ?? 0),
        freeFlowKph: Number(feature.properties?.freeFlow ?? 0),
        speedRatio: Number(feature.properties?.freeFlow) ? Number((Number(feature.properties?.speed ?? 0) / Number(feature.properties?.freeFlow)).toFixed(3)) : null,
        delaySeconds: Number(feature.properties?.delaySeconds ?? 0),
        congestionLevel: feature.properties?.congestionLevel ?? "unknown",
        congestionRank: congestionOrder(feature.properties?.congestionLevel),
        confidence: Number(feature.properties?.confidence ?? 0),
        roadClosure: Boolean(feature.properties?.roadClosure),
        collectedAt: live.collectedAt ?? null,
      },
    ),
  );
  await writeArtifact("data/map-views/tomtom/latest-flow.geojson", fc(latestFlow), stats);

  const slots = ["morning-rush", "mid-morning", "midday", "afternoon-rush", "evening", "night"];
  for (const slot of slots) {
    const features = (flow.flow ?? [])
      .filter((row) => String(row.timeSlot ?? row.slot ?? row.label ?? "").includes(slot) || flow.timeSlots?.find((entry) => entry.label === slot && entry.hour === row.slotHour))
      .map((row, index) => tomtomLineFeature(row, `tomtom-${slot}-${index}`))
      .filter(Boolean);
    await writeArtifact(`data/map-views/tomtom/timeslot-${slot}.geojson`, fc(features), stats);
  }

  const severeFeatures = [...latestFlow, ...(flow.flow ?? []).map((row, index) => tomtomLineFeature(row, `tomtom-historical-${index}`)).filter(Boolean)]
    .filter((feature) => Number(feature.properties.congestionRank ?? 0) >= 3 || feature.properties.roadClosure);
  await writeArtifact("data/map-views/tomtom/severe-heavy.geojson", fc(severeFeatures), stats);

  const incidentFeatures = (flow.incidents ?? []).map((incident, index) =>
    writeFeature(
      `tomtom-incident-${incident.incidentId ?? index}`,
      { type: "Point", coordinates: [roundCoord(Number(incident.lng)), roundCoord(Number(incident.lat))] },
      {
        label: `Incident ${incident.incidentId ?? index}`,
        source: "TomTom incidents",
        kind: "incident",
        severity: incident.severity ?? null,
        typeCode: incident.type ?? null,
        collectedAt: incident.collectedAt ?? flow.collectedAt ?? null,
      },
    ),
  );
  await writeArtifact("data/map-views/tomtom/incidents.geojson", fc(incidentFeatures), stats);
}

const ROAD_PREFIX_RE = /^(strada|str\.|str|bulevardul|bulevard|bd\.|b-dul|calea|splaiul|splai|podul|pod|piata|piața|aleea|intrarea|drumul|drum)\s+/i;
const DATE_RANGE_RE = /(\d{2}\.\d{2}\.\d{4})(?:\s*[–-]\s*(\d{2}\.\d{2}\.\d{4}))?/g;

function stripDiacritics(value) {
  return String(value).normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeText(value) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRomanianDate(dateText) {
  const [day, month, year] = dateText.split(".").map((part) => Number(part));
  if (!day || !month || !year) return null;
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function classifyClosure(record) {
  DATE_RANGE_RE.lastIndex = 0;
  const windows = [];
  let match;
  while ((match = DATE_RANGE_RE.exec(record.text ?? ""))) {
    const start = parseRomanianDate(match[1]);
    const end = parseRomanianDate(match[2] ?? match[1]);
    if (start && end) windows.push({ start, end });
  }
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const sorted = windows.sort((a, b) => a.start.getTime() - b.start.getTime());
  const active = sorted.find((window) => window.start <= today && today <= window.end);
  if (active) return { status: "active", label: "closed now", start: active.start, end: active.end };
  const scheduled = sorted.find((window) => window.start > today);
  if (scheduled) return { status: "scheduled", label: "scheduled", start: scheduled.start, end: scheduled.end };
  const recent = [...sorted].reverse().find((window) => (today.getTime() - window.end.getTime()) / 86_400_000 <= 21);
  if (recent) return { status: "recent", label: "recently cleared", start: recent.start, end: recent.end };
  const latest = sorted[sorted.length - 1];
  return { status: "expired", label: windows.length ? "expired" : "status unavailable", start: latest?.start ?? null, end: latest?.end ?? null };
}

function roadVariants(name) {
  const normalized = normalizeText(name);
  return [normalized, normalized.replace(ROAD_PREFIX_RE, "").trim()].filter(Boolean);
}

async function buildClosures(stats) {
  const manifest = readJson(paths.closures, { records: [] });
  const roads = readJson(paths.osmRoads, fc());
  const namedRoads = roads.features.filter((feature) => typeof feature.properties?.name === "string" && feature.properties.name.trim());
  const features = [];

  for (const [recordIndex, record] of (manifest.records ?? []).entries()) {
    const status = classifyClosure(record);
    const recordSearch = normalizeText([record.title, record.text, ...(record.roads ?? [])].join(" "));
    const matched = namedRoads.filter((road) => roadVariants(road.properties.name).some((variant) => recordSearch.includes(variant) || variant.includes(recordSearch)));
    const roadFallbacks = matched.length ? matched : [];
    for (const [index, road] of roadFallbacks.entries()) {
      const id = `closure-${recordIndex}-${index}`;
      features.push(
        writeFeature(
          id,
          { type: "LineString", coordinates: cleanLineCoordinates(road.geometry.coordinates, road.properties?.rank >= 5 ? 1 : 2) },
          {
            label: `${record.title} · ${road.properties.name}`,
            source: "Primaria Municipiului Timisoara",
            kind: "closure",
            status: status.status,
            statusLabel: status.label,
            roadName: road.properties.name,
            roadHint: (record.roads ?? []).join(" · "),
            noticeTitle: record.title,
            noticeUrl: record.url,
            publishedAt: record.publishedAt,
            windowStart: status.start?.toISOString() ?? null,
            windowEnd: status.end?.toISOString() ?? null,
            eventLike: /eveniment|meci|concert|maraton|parad|manifest/i.test(`${record.title} ${record.text}`),
          },
        ),
      );
    }
  }

  const byStatus = {
    all: features,
    active: features.filter((feature) => feature.properties.status === "active"),
    scheduled: features.filter((feature) => feature.properties.status === "scheduled"),
    recent: features.filter((feature) => feature.properties.status === "recent"),
    expired: features.filter((feature) => feature.properties.status === "expired"),
    events: features.filter((feature) => feature.properties.eventLike),
  };

  for (const [name, list] of Object.entries(byStatus)) {
    await writeArtifact(`data/map-views/closures/${name}.geojson`, fc(list), stats);
  }
}

function pointFeature(id, lng, lat, properties) {
  if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) return null;
  return writeFeature(id, { type: "Point", coordinates: [roundCoord(Number(lng)), roundCoord(Number(lat))] }, properties);
}

async function buildSignals(stats) {
  const programs = readJson(paths.signals, { programs: [] }).programs ?? [];
  const candidateManifest = readJson(paths.signalCandidates, { candidates: [] });
  const controls = readJson(paths.osmControls, fc());
  const programOsmIds = new Set(programs.map((program) => Number(program.osmId)).filter(Number.isFinite));
  const candidates = (candidateManifest.candidates ?? []).map((candidate, index) =>
    pointFeature(`signal-candidate-${candidate.id ?? index}`, candidate.candidate?.lng, candidate.candidate?.lat, {
      label: `Candidate ${candidate.id ?? index}`,
      source: "STPT stop inference",
      kind: "signal-candidate",
      route: candidate.route ?? null,
      sampleCount: Number(candidate.sampleCount ?? 0),
      stopCount: Number(candidate.stopResumeMarkers?.stopCount ?? 0),
      resumeCount: Number(candidate.stopResumeMarkers?.resumeCount ?? 0),
      confidence: Number(candidate.finalConfidence ?? 0),
      band: Number(candidate.finalConfidence ?? 0) >= 0.75 ? "high" : Number(candidate.finalConfidence ?? 0) >= 0.45 ? "medium" : "low",
    }),
  ).filter(Boolean);
  const provided = programs.map((program, index) =>
    pointFeature(`signal-program-${program.id ?? index}`, program.position?.lng, program.position?.lat, {
      label: program.name ?? `Signal ${index}`,
      source: "traffic-light programs",
      kind: "signal-program",
      osmId: program.osmId ?? null,
      sampleCount: Number(program.sampleCount ?? 0),
      phaseCount: Array.isArray(program.phases) ? program.phases.length : 0,
      cycleSeconds: Array.isArray(program.phases) ? program.phases.reduce((total, phase) => total + Number(phase.durationSeconds ?? 0), 0) : null,
      confidence: 1,
      band: "high",
    }),
  ).filter(Boolean);
  const unmapped = controls.features
    .filter((feature) => String(feature.properties?.kind ?? "").includes("traffic_signal") && !programOsmIds.has(Number(feature.properties?.osmId)))
    .map((feature, index) =>
      writeFeature(`osm-unmapped-signal-${feature.properties?.osmId ?? index}`, feature.geometry, {
        label: feature.properties?.name ?? `OSM signal ${feature.properties?.osmId ?? index}`,
        source: "OpenStreetMap",
        kind: "unmapped-osm-signal",
        osmId: feature.properties?.osmId ?? null,
        confidence: 0,
        band: "low",
      }),
    );
  const stopHotspots = candidates.filter((feature) => Number(feature.properties.stopCount ?? 0) > 0);

  await writeArtifact("data/map-views/signals/candidates.geojson", fc(candidates), stats);
  await writeArtifact("data/map-views/signals/provided.geojson", fc(provided), stats);
  await writeArtifact("data/map-views/signals/unmapped-osm.geojson", fc(unmapped), stats);
  await writeArtifact("data/map-views/signals/stop-hotspots.geojson", fc(stopHotspots), stats);
  for (const band of ["low", "medium", "high"]) {
    await writeArtifact(`data/map-views/signals/confidence-${band}.geojson`, fc(candidates.filter((feature) => feature.properties.band === band)), stats);
  }
}

function offsetLineString(coordinates, offsetMeters, reverse = false) {
  if (!Array.isArray(coordinates) || coordinates.length < 2 || offsetMeters === 0) return cleanLineCoordinates(coordinates ?? [], 1);
  const points = reverse ? [...coordinates].reverse() : coordinates;
  const offsets = points.map((point, index) => {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const metersPerLng = Math.cos((Number(point[1]) * Math.PI) / 180) * 111_320;
    const dx = (Number(next[0]) - Number(prev[0])) * metersPerLng;
    const dy = (Number(next[1]) - Number(prev[1])) * 111_320;
    const length = Math.hypot(dx, dy) || 1;
    const normalX = (-dy / length) * offsetMeters;
    const normalY = (dx / length) * offsetMeters;
    return [roundCoord(Number(point[0]) + normalX / metersPerLng), roundCoord(Number(point[1]) + normalY / 111_320)];
  });
  return reverse ? offsets.reverse() : offsets;
}

function parseLaneCount(value, rank) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.max(1, Math.min(4, Math.round(parsed)));
  return rank >= 7 ? 2 : 1;
}

async function buildOsm(stats) {
  const roads = readJson(paths.osmRoads, fc());
  const controls = readJson(paths.osmControls, fc());
  const major = [];
  const minor = [];
  const lanes = [];

  for (const [index, road] of roads.features.entries()) {
    const rank = Number(road.properties?.rank ?? 0);
    const target = rank >= 5 ? major : minor;
    if (rank >= 3) target.push(
      writeFeature(`osm-road-${road.properties?.osmId ?? index}`, { type: "LineString", coordinates: cleanLineCoordinates(road.geometry.coordinates, rank >= 5 ? 1 : 6) }, {
        label: road.properties?.name ?? road.properties?.highway ?? `Road ${index}`,
        source: "OpenStreetMap",
        kind: "road",
        osmId: road.properties?.osmId ?? null,
        name: road.properties?.name ?? null,
        highway: road.properties?.highway ?? null,
        rank,
        lanes: road.properties?.lanes ?? null,
        maxspeed: road.properties?.maxspeed ?? null,
      }),
    );
    const laneCount = parseLaneCount(road.properties?.lanes, rank);
    if (rank >= 6 && laneCount >= 2) {
      const center = (laneCount - 1) / 2;
      const reverse = String(road.properties?.oneway ?? "") === "-1";
      for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
        const offsetMeters = (laneIndex - center) * 3.4;
        lanes.push(
          writeFeature(`osm-lane-${road.properties?.osmId ?? index}-${laneIndex}`, { type: "LineString", coordinates: offsetLineString(road.geometry.coordinates, offsetMeters, reverse) }, {
            label: `${road.properties?.name ?? road.properties?.highway ?? "Road"} lane ${laneIndex + 1}`,
            source: "generated from OSM",
            kind: "lane-band",
            osmId: road.properties?.osmId ?? null,
            rank,
            laneIndex,
            laneCount,
            offsetMeters: Number(offsetMeters.toFixed(1)),
          }),
        );
      }
    }
  }

  const trafficSignals = controls.features
    .filter((feature) => String(feature.properties?.kind ?? "").includes("traffic_signal"))
    .map((feature, index) => writeFeature(`osm-signal-${feature.properties?.osmId ?? index}`, feature.geometry, {
      label: feature.properties?.name ?? `Traffic signal ${feature.properties?.osmId ?? index}`,
      source: "OpenStreetMap",
      kind: "traffic-signal",
      osmId: feature.properties?.osmId ?? null,
    }));
  const crossings = controls.features
    .filter((feature) => String(feature.properties?.kind ?? "").includes("crossing") || feature.properties?.crossing)
    .map((feature, index) => writeFeature(`osm-crossing-${feature.properties?.osmId ?? index}`, feature.geometry, {
      label: feature.properties?.name ?? `Crossing ${feature.properties?.osmId ?? index}`,
      source: "OpenStreetMap",
      kind: "crossing",
      osmId: feature.properties?.osmId ?? null,
      crossing: feature.properties?.crossing ?? null,
    }));

  await writeArtifact("data/map-views/osm/roads-major.geojson", fc(major), stats);
  await writeArtifact("data/map-views/osm/roads-minor-simplified.geojson", fc(minor), stats);
  await writeArtifact("data/map-views/osm/lane-bands.geojson", fc(lanes), stats);
  await writeArtifact("data/map-views/osm/traffic-signals.geojson", fc(trafficSignals), stats);
  await writeArtifact("data/map-views/osm/crossings.geojson", fc(crossings), stats);
}

async function buildTransit(stats) {
  const aggregation = readJson(paths.probeAggregation, { byRoute: [] });
  const routes = (aggregation.byRoute ?? []).filter((route) => Array.isArray(route.geometry) && route.geometry.length >= 2);
  const routeFeatures = routes.map((route) =>
    writeFeature(`transit-route-${route.route ?? route.segmentId}`, { type: "LineString", coordinates: cleanLineCoordinates(route.geometry, 1) }, {
      label: `Route ${route.route ?? route.segmentId}`,
      source: "STPT historical probes",
      kind: "transit-corridor",
      route: route.route ?? route.segmentId,
      sampleCount: Number(route.sampleCount ?? 0),
      avgSpeedKph: Number(route.avgSpeedKph ?? 0),
      avgDelaySeconds: Number(route.avgDelaySeconds ?? 0),
      densityRank: Math.min(5, Math.max(1, Math.ceil(Number(route.sampleCount ?? 0) / 10000))),
    }),
  );
  await writeArtifact("data/map-views/transit/delay-corridors.geojson", fc(routeFeatures.filter((feature) => Number(feature.properties.avgDelaySeconds) > 0)), stats);
  await writeArtifact("data/map-views/transit/speed-corridors.geojson", fc(routeFeatures), stats);
  await writeArtifact("data/map-views/transit/sample-density.geojson", fc(routeFeatures), stats);

  for (const feature of routeFeatures.filter((entry) => Number(entry.properties.sampleCount) >= 1000)) {
    const route = String(feature.properties.route).replace(/[^a-z0-9_-]/gi, "_");
    await writeArtifact(`data/map-views/transit/routes/${route}.geojson`, fc([feature]), stats);
  }
}

async function buildStptLive(stats) {
  const vehicles = readJson(paths.stptVehicles, fc());
  const snapshot = readJson(paths.stptSnapshot, {});
  const normalizedVehicles = vehicles.features.map((feature, index) =>
    writeFeature(`stpt-vehicle-${feature.properties?.id ?? index}`, feature.geometry, {
      label: `${feature.properties?.route ?? "route"} · ${feature.properties?.headsign ?? "no headsign"}`,
      source: "STPT live",
      kind: "vehicle",
      route: feature.properties?.route ?? null,
      bearing: Number(feature.properties?.bearing ?? 0),
      speedKph: Number(feature.properties?.speed ?? 0),
      directionId: feature.properties?.directionId ?? null,
      headsign: feature.properties?.headsign ?? null,
      stop: feature.properties?.stop ?? null,
      timestamp: feature.properties?.timestamp ?? null,
      isAccessible: Boolean(feature.properties?.isAccessible),
      collectedAt: snapshot.collectedAt ?? null,
    }),
  );
  await writeArtifact("data/map-views/stpt-live/vehicles.geojson", fc(normalizedVehicles), stats);
  await writeArtifact("data/map-views/stpt-live/accessible.geojson", fc(normalizedVehicles.filter((feature) => feature.properties.isAccessible)), stats);
  await writeArtifact("data/map-views/stpt-live/not-accessible.geojson", fc(normalizedVehicles.filter((feature) => !feature.properties.isAccessible)), stats);

  const byRoute = new Map();
  for (const feature of normalizedVehicles) {
    const route = String(feature.properties.route ?? "unknown").replace(/[^a-z0-9_-]/gi, "_");
    byRoute.set(route, [...(byRoute.get(route) ?? []), feature]);
  }
  for (const [route, features] of byRoute) {
    await writeArtifact(`data/map-views/stpt-live/vehicles-by-route/${route}.geojson`, fc(features), stats);
  }

  const stops = Object.values(readJson(paths.stptStops, {})).map((stop) =>
    pointFeature(`stpt-stop-${stop.id}`, stop.lng, stop.lat, {
      label: stop.name ?? `Stop ${stop.id}`,
      source: "STPT stations index",
      kind: "stop",
      stopId: stop.id,
      name: stop.name ?? null,
      lines: Array.isArray(stop.lines) ? stop.lines.join(", ") : "",
      lineCount: Array.isArray(stop.lines) ? stop.lines.length : 0,
    }),
  ).filter(Boolean);
  await writeArtifact("data/map-views/stpt-live/stops.geojson", fc(stops), stats);
}

async function buildScenariosAndGaps(stats) {
  const scenarios = readJson(paths.scenarios, []);
  const scenarioFeatures = (Array.isArray(scenarios) ? scenarios : []).map((scenario, index) =>
    pointFeature(`scenario-${scenario.id ?? index}`, scenario.center?.lng ?? TIMISOARA_CENTER[0], scenario.center?.lat ?? TIMISOARA_CENTER[1], {
      label: scenario.name ?? scenario.id ?? `Scenario ${index}`,
      source: "scenario catalog",
      kind: "scenario",
      scenarioId: scenario.id ?? null,
      district: scenario.district ?? null,
      durationSeconds: scenario.durationSeconds ?? null,
      actorCount: Array.isArray(scenario.actors) ? scenario.actors.length : 0,
      signalCount: Array.isArray(scenario.signals) ? scenario.signals.length : 0,
    }),
  ).filter(Boolean);
  await writeArtifact("data/map-views/scenarios/catalog.geojson", fc(scenarioFeatures), stats);

  const gaps = [
    [21.226, 45.752, "CSV-only open mobility datasets", "Needs geometry adapter for reliable map rendering."],
    [21.205, 45.743, "Closure notices without road match", "Some notices mention places rather than OSM road names."],
    [21.219, 45.759, "Traffic signal timings", "OSM signals without interval data remain unmapped."],
    [21.195, 45.748, "Historical vehicle traces", "Large probe histories stay out of browser map pages."],
  ].map(([lng, lat, label, caveat], index) => pointFeature(`data-gap-${index}`, lng, lat, {
    label,
    source: "map-view adapter",
    kind: "data-gap",
    caveat,
  })).filter(Boolean);
  await writeArtifact("data/map-views/data-gaps/gaps.geojson", fc(gaps), stats);
}

function manifestPageEntries(stats) {
  return pageCatalog.map(([id, title, category, artifactPath, description]) => {
    const artifacts = artifactPath.split(",");
    const concreteArtifacts = artifacts.filter((artifact) => !artifact.includes("{"));
    const featureCount = concreteArtifacts.reduce((total, artifact) => total + Number(stats.artifacts[artifact]?.featureCount ?? 0), 0);
    return {
      id,
      path: `/maps/${id}`,
      title,
      category,
      description,
      artifacts,
      featureCount,
      freshness: freshnessForCategory(category),
      sourcePaths: sourcePathsForCategory(category),
      caveats: caveatsForCategory(category),
    };
  });
}

function freshnessForCategory(category) {
  const source = {
    STPT: readJson(paths.stptSnapshot, {})?.collectedAt,
    TomTom: readJson(paths.tomtomFlow, {})?.collectedAt ?? readJson(paths.tomtomLive, {})?.collectedAt,
    Closures: readJson(paths.closures, {})?.collectedAt,
    Signals: readJson(paths.signalCandidates, {})?.generatedAt ?? readJson(paths.signals, {})?.generatedAt,
    OSM: readJson("data/osm/timisoara-osm-manifest.json", {})?.generatedAt,
    "Transit Corridors": readJson(paths.probeAggregation, {})?.generatedAt,
    Scenarios: GENERATED_AT,
    Quality: GENERATED_AT,
  }[category];
  return source ?? GENERATED_AT;
}

function sourcePathsForCategory(category) {
  return {
    STPT: [paths.stptVehicles, paths.stptStops],
    TomTom: [paths.tomtomLiveGeoJson, paths.tomtomFlow],
    Closures: [paths.closures, paths.osmRoads],
    Signals: [paths.signalCandidates, paths.signals, paths.osmControls],
    OSM: [paths.osmRoads, paths.osmControls],
    "Transit Corridors": [paths.probeAggregation],
    Scenarios: [paths.scenarios],
    Quality: ["data/sources/timisoara-open-data/*.csv", paths.closures, paths.signals],
  }[category] ?? [];
}

function caveatsForCategory(category) {
  return {
    STPT: ["Live vehicle artifacts reflect the latest checked-in STPT snapshot."],
    TomTom: ["TomTom artifacts are local cached snapshots and are not live navigation guidance."],
    Closures: ["Closure geometry is matched from notice text to OSM road names at build time."],
    Signals: ["Signal confidence is inferred from STPT stop/resume behavior unless a program is provided."],
    OSM: ["Minor roads are simplified for map-view use; full OSM roads stay out of browser atlas pages."],
    "Transit Corridors": ["Corridors are aggregate route samples, not per-vehicle histories."],
    Quality: ["CSV-only or weakly geocoded datasets stay as data-gap markers until better adapters exist."],
  }[category] ?? [];
}

async function main() {
  const stats = { generatedAt: GENERATED_AT, artifacts: {} };
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  await buildTomTom(stats);
  await buildClosures(stats);
  await buildSignals(stats);
  await buildTransit(stats);
  await buildOsm(stats);
  await buildStptLive(stats);
  await buildScenariosAndGaps(stats);

  const manifest = {
    generatedAt: GENERATED_AT,
    version: 1,
    center: TIMISOARA_CENTER,
    artifactWarnings: Object.entries(stats.artifacts)
      .filter(([, value]) => value.warning)
      .map(([path, value]) => ({ path, warning: value.warning, bytes: value.bytes })),
    pages: manifestPageEntries(stats),
    artifacts: stats.artifacts,
    performanceRules: [
      "Browser atlas pages must not load data/derived/queue-estimates.json.",
      "Browser atlas pages must not load full data/osm/timisoara-roads.geojson unless explicitly debugging.",
      "Heavy matching, reduction, and time-slot grouping are done by scripts/build-map-view-datasets.mjs.",
    ],
  };
  await writeArtifact("data/map-views/manifest.json", manifest, stats);
  console.log(`[map-views] generated ${Object.keys(stats.artifacts).length} artifacts in data/map-views`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

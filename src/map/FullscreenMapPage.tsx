import { useEffect, useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapAtlasView, MapAtlasVariant } from "./mapAtlas";

type MapStyleMode = "midnight" | "daylight" | "aerial";

interface FullscreenMapPageProps {
  view: MapAtlasView;
  navigate: (path: string) => void;
}

type SelectedFeature = {
  title: string;
  details: Array<[string, string]>;
};
type AtlasMetric = {
  label: string;
  value: string;
};

const emptyCollection: FeatureCollection = { type: "FeatureCollection", features: [] };
const mapStyleModes: Array<{ id: MapStyleMode; label: string; note: string }> = [
  { id: "midnight", label: "Midnight", note: "dark city mode" },
  { id: "daylight", label: "Daylight", note: "high-contrast streets" },
  { id: "aerial", label: "Satellite", note: "aerial-toned canvas" },
];

function theme(mode: MapStyleMode) {
  if (mode === "daylight") {
    return { background: "#dfe8ef", road: "#415f73", minor: "#96a9b7", text: "#0f172a" };
  }
  if (mode === "aerial") {
    return { background: "#0f1a12", road: "#f5e6ba", minor: "#6b8f71", text: "#f7f7eb" };
  }
  return { background: "#06111d", road: "#8aa7bb", minor: "#506a7f", text: "#edf7ff" };
}

function colorExpression(colorMode: MapAtlasView["colorMode"], fallback = "#65d6ff") {
  switch (colorMode) {
    case "congestion":
      return [
        "match",
        ["get", "congestionLevel"],
        "low",
        "#22c55e",
        "free",
        "#22c55e",
        "light",
        "#facc15",
        "synchronized",
        "#fb923c",
        "moderate",
        "#fb923c",
        "heavy",
        "#f97316",
        "severe",
        "#ef4444",
        "blocked",
        "#ef4444",
        fallback,
      ];
    case "closure":
      return ["match", ["get", "status"], "active", "#ff5c7a", "scheduled", "#ffd166", "recent", "#38bdf8", "expired", "#94a3b8", fallback];
    case "signalConfidence":
      return ["match", ["get", "band"], "high", "#22c55e", "medium", "#facc15", "low", "#fb7185", fallback];
    case "transitDelay":
      return ["interpolate", ["linear"], ["coalesce", ["get", "avgDelaySeconds"], 0], 0, "#38bdf8", 20, "#facc15", 45, "#ef4444"];
    case "transitSpeed":
      return ["interpolate", ["linear"], ["coalesce", ["get", "avgSpeedKph"], 0], 0, "#ef4444", 18, "#facc15", 35, "#22c55e"];
    case "sampleDensity":
      return ["interpolate", ["linear"], ["coalesce", ["get", "densityRank"], 1], 1, "#38bdf8", 3, "#facc15", 5, "#ef4444"];
    case "roadRank":
      return ["interpolate", ["linear"], ["coalesce", ["get", "rank"], 1], 1, "#64748b", 5, "#cbd5e1", 8, "#f8fafc"];
    case "laneBand":
      return ["match", ["get", "laneIndex"], 0, "#38bdf8", 1, "#facc15", 2, "#fb7185", 3, "#a78bfa", fallback];
    case "osmControl":
      return ["match", ["get", "kind"], "traffic-signal", "#fb7185", "crossing", "#ffd166", fallback];
    case "stpt":
      return ["case", ["==", ["get", "kind"], "stop"], "#ffd166", ["==", ["get", "isAccessible"], true], "#7cffb2", "#65d6ff"];
    default:
      return fallback;
  }
}

function buildStyle(mode: MapStyleMode, view: MapAtlasView): StyleSpecification {
  const colors = theme(mode);
  const sourceIds = view.artifactPaths.map((_, index) => `atlas-${index}`);
  const layers: StyleSpecification["layers"] = [{ id: "background", type: "background", paint: { "background-color": colors.background } }];

  for (const [index, sourceId] of sourceIds.entries()) {
    layers.push({
      id: `${sourceId}-line-shadow`,
      type: "line",
      source: sourceId,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": mode === "daylight" ? "#ffffff" : "#020617",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.4, 14, 8, 17, 18],
        "line-opacity": index === 0 ? 0.36 : 0.28,
      },
    });
    layers.push({
      id: `${sourceId}-line`,
      type: "line",
      source: sourceId,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": colorExpression(view.colorMode, colors.road) as never,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          view.colorMode === "roadRank" ? 0.8 : view.colorMode === "laneBand" ? 1.1 : 1.8,
          14,
          view.colorMode === "roadRank" ? ["+", ["coalesce", ["get", "rank"], 2], 0.5] : view.colorMode === "laneBand" ? 3 : 5,
          17,
          view.colorMode === "roadRank" ? ["*", ["coalesce", ["get", "rank"], 2], 1.8] : view.colorMode === "laneBand" ? 8 : 12,
        ] as never,
        "line-opacity": view.colorMode === "roadRank" && index === 0 ? 0.54 : view.colorMode === "laneBand" ? 0.82 : 0.92,
      },
    });
    layers.push({
      id: `${sourceId}-circle-halo`,
      type: "circle",
      source: sourceId,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": mode === "daylight" ? "#ffffff" : "#020617",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 14, 9, 17, 17],
        "circle-opacity": 0.54,
      },
    });
    layers.push({
      id: `${sourceId}-circle`,
      type: "circle",
      source: sourceId,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": colorExpression(view.colorMode, "#65d6ff") as never,
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          ["case", ["==", ["get", "kind"], "stop"], 2.2, ["has", "sampleCount"], ["+", 3, ["min", 4, ["/", ["coalesce", ["get", "sampleCount"], 0], 300]]], 3],
          14,
          ["case", ["==", ["get", "kind"], "stop"], 4.2, ["has", "sampleCount"], ["+", 6, ["min", 9, ["/", ["coalesce", ["get", "sampleCount"], 0], 180]]], 6],
          17,
          ["case", ["==", ["get", "kind"], "stop"], 8, ["has", "sampleCount"], ["+", 10, ["min", 16, ["/", ["coalesce", ["get", "sampleCount"], 0], 120]]], 12],
        ] as never,
        "circle-stroke-color": mode === "daylight" ? "#ffffff" : "rgba(255,255,255,0.78)",
        "circle-stroke-width": 1.2,
        "circle-opacity": 0.94,
      },
    });
  }

  return {
    version: 8,
    sources: Object.fromEntries(sourceIds.map((sourceId) => [sourceId, { type: "geojson", data: emptyCollection }])) as never,
    layers,
  };
}

function mergeBounds(collections: FeatureCollection[]) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const visit = (coords: unknown) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      minLng = Math.min(minLng, coords[0]);
      minLat = Math.min(minLat, coords[1]);
      maxLng = Math.max(maxLng, coords[0]);
      maxLat = Math.max(maxLat, coords[1]);
      return;
    }
    coords.forEach(visit);
  };
  collections.forEach((collection) =>
    collection.features.forEach((feature) => {
      if (feature.geometry.type === "GeometryCollection") {
        feature.geometry.geometries.forEach((geometry) => {
          if ("coordinates" in geometry) visit(geometry.coordinates);
        });
        return;
      }
      visit(feature.geometry.coordinates);
    }),
  );
  if (!Number.isFinite(minLng)) return null;
  return [[minLng, minLat], [maxLng, maxLat]] as [[number, number], [number, number]];
}

function allFeatures(collections: FeatureCollection[]) {
  return collections.flatMap((collection) => collection.features);
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
}

function formatPercent(value: unknown) {
  const numeric = asNumber(value);
  if (numeric === null) return String(value);
  return `${formatNumber(numeric * 100, 0)}%`;
}

function formatDateTime(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  const raw = typeof value === "number" && value > 10_000_000_000 ? value : String(value);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function metricValue(value: number | null | undefined, suffix = "", digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${formatNumber(value, digits)}${suffix}`;
}

function uniqueCount(features: Feature<Geometry, GeoJsonProperties>[], key: string) {
  return new Set(features.map((feature) => feature.properties?.[key]).filter((value) => value !== undefined && value !== null && value !== "")).size;
}

function countWhere(features: Feature<Geometry, GeoJsonProperties>[], predicate: (props: Record<string, unknown>) => boolean) {
  return features.filter((feature) => predicate(feature.properties ?? {})).length;
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function maxValue(values: number[]) {
  return values.length ? Math.max(...values) : null;
}

function metricCandidates(view: MapAtlasView, features: Feature<Geometry, GeoJsonProperties>[]): AtlasMetric[] {
  const props = features.map((feature) => (feature.properties ?? {}) as Record<string, unknown>);
  const speeds = props.map((item) => asNumber(item.speedKph)).filter((value): value is number => value !== null);
  const speedRatios = props.map((item) => asNumber(item.speedRatio)).filter((value): value is number => value !== null);
  const delays = props.map((item) => asNumber(item.delaySeconds ?? item.avgDelaySeconds)).filter((value): value is number => value !== null);
  const samples = props.map((item) => asNumber(item.sampleCount)).filter((value): value is number => value !== null);
  const cycleSeconds = props.map((item) => asNumber(item.cycleSeconds)).filter((value): value is number => value !== null && value > 0);
  const roadIds = uniqueCount(features, "osmId") || uniqueCount(features, "roadName");

  if (view.category === "TomTom") {
    return [
      { label: "segments", value: formatNumber(features.length) },
      { label: "severe/heavy", value: formatNumber(countWhere(features, (item) => ["heavy", "severe", "blocked"].includes(String(item.congestionLevel)))) },
      { label: "avg speed ratio", value: metricValue(average(speedRatios), "x", 2) },
      { label: "max delay", value: metricValue(maxValue(delays), "s", 0) },
    ];
  }

  if (view.category === "Closures") {
    return [
      { label: "matched roads", value: formatNumber(features.length) },
      { label: "notices", value: formatNumber(uniqueCount(features, "noticeTitle")) },
      { label: "active", value: formatNumber(countWhere(features, (item) => item.status === "active")) },
      { label: "events", value: formatNumber(countWhere(features, (item) => Boolean(item.eventLike))) },
    ];
  }

  if (view.category === "Signals") {
    return [
      { label: "signals", value: formatNumber(features.length) },
      { label: "high confidence", value: formatNumber(countWhere(features, (item) => item.band === "high")) },
      { label: "samples", value: formatNumber(samples.reduce((total, value) => total + value, 0)) },
      { label: "avg cycle", value: metricValue(average(cycleSeconds), "s", 0) },
    ];
  }

  if (view.category === "Transit Corridors") {
    const slowest = props.reduce<Record<string, unknown> | null>((candidate, item) => {
      const speed = asNumber(item.avgSpeedKph);
      if (speed === null) return candidate;
      const candidateSpeed = asNumber(candidate?.avgSpeedKph);
      return candidateSpeed === null || speed < candidateSpeed ? item : candidate;
    }, null);
    return [
      { label: "routes", value: formatNumber(features.length) },
      { label: "slowest", value: slowest?.route ? `${slowest.route} · ${metricValue(asNumber(slowest.avgSpeedKph), " km/h", 1)}` : "n/a" },
      { label: "max delay", value: metricValue(maxValue(delays), "s", 0) },
      { label: "samples", value: formatNumber(samples.reduce((total, value) => total + value, 0)) },
    ];
  }

  if (view.category === "STPT") {
    const stops = countWhere(features, (item) => item.kind === "stop");
    const vehicles = features.length - stops;
    return [
      { label: stops ? "stops" : "vehicles", value: formatNumber(stops || vehicles) },
      { label: stops ? "served lines" : "routes", value: formatNumber(stops ? uniqueCount(features, "lines") : uniqueCount(features, "route")) },
      { label: "accessible", value: formatNumber(countWhere(features, (item) => Boolean(item.isAccessible))) },
      { label: stops ? "max line count" : "stopped", value: formatNumber(stops ? maxValue(props.map((item) => asNumber(item.lineCount)).filter((value): value is number => value !== null)) ?? 0 : countWhere(features, (item) => asNumber(item.speedKph) === 0)) },
    ];
  }

  if (view.category === "OSM") {
    return [
      { label: view.colorMode === "laneBand" ? "lane bands" : "features", value: formatNumber(features.length) },
      { label: "roads", value: formatNumber(roadIds || features.length) },
      { label: "signals", value: formatNumber(countWhere(features, (item) => item.kind === "traffic-signal")) },
      { label: "crossings", value: formatNumber(countWhere(features, (item) => item.kind === "crossing")) },
    ];
  }

  if (view.category === "Scenarios") {
    return [
      { label: "scenarios", value: formatNumber(features.length) },
      { label: "districts", value: formatNumber(uniqueCount(features, "district")) },
      { label: "signals", value: formatNumber(props.reduce((total, item) => total + (asNumber(item.signalCount) ?? 0), 0)) },
    ];
  }

  return [
    { label: "gaps", value: formatNumber(features.length) },
    { label: "sources", value: formatNumber(uniqueCount(features, "source")) },
  ];
}

const detailLabels: Record<string, string> = {
  avgDelaySeconds: "avg delay",
  avgSpeedKph: "avg speed",
  band: "band",
  caveat: "caveat",
  collectedAt: "collected",
  confidence: "confidence",
  congestionLevel: "congestion",
  crossing: "crossing",
  cycleSeconds: "cycle",
  delaySeconds: "delay",
  densityRank: "density rank",
  district: "district",
  durationSeconds: "duration",
  freeFlowKph: "free flow",
  headsign: "headsign",
  highway: "road class",
  isAccessible: "accessible",
  kind: "kind",
  laneCount: "lanes",
  laneIndex: "lane",
  lineCount: "line count",
  lines: "lines",
  maxspeed: "max speed",
  name: "name",
  noticeTitle: "notice",
  noticeUrl: "notice URL",
  offsetMeters: "offset",
  osmId: "OSM id",
  phaseCount: "phases",
  publishedAt: "published",
  rank: "rank",
  roadClosure: "road closure",
  roadHint: "notice roads",
  roadName: "road",
  route: "route",
  sampleCount: "samples",
  scenarioId: "scenario",
  source: "source",
  speedKph: "speed",
  speedRatio: "speed ratio",
  statusLabel: "status",
  stop: "stop",
  stopCount: "stops observed",
  timestamp: "timestamp",
  typeCode: "type",
  windowEnd: "ends",
  windowStart: "starts",
};

function formatDetail(key: string, value: unknown) {
  if (key === "confidence") return formatPercent(value);
  if (key === "speedRatio") return `${metricValue(asNumber(value), "x", 2)}`;
  if (key === "speedKph" || key === "freeFlowKph" || key === "avgSpeedKph" || key === "maxspeed") return `${metricValue(asNumber(value), " km/h", 1)}`;
  if (key === "delaySeconds" || key === "avgDelaySeconds" || key === "cycleSeconds" || key === "durationSeconds") return `${metricValue(asNumber(value), "s", 0)}`;
  if (key === "offsetMeters") return `${metricValue(asNumber(value), "m", 1)}`;
  if (key === "laneIndex") {
    const numeric = asNumber(value);
    return numeric === null ? String(value) : String(numeric + 1);
  }
  if (key === "isAccessible" || key === "roadClosure") return value ? "yes" : "no";
  if (key === "timestamp" || key === "collectedAt" || key === "publishedAt" || key === "windowStart" || key === "windowEnd") return formatDateTime(value);
  return String(value);
}

function featureDetails(feature: Feature<Geometry, GeoJsonProperties>, view: MapAtlasView): SelectedFeature {
  const props = feature.properties ?? {};
  const fallbackKeys = [
    "route",
    "headsign",
    "stop",
    "speedKph",
    "freeFlowKph",
    "speedRatio",
    "delaySeconds",
    "congestionLevel",
    "statusLabel",
    "roadName",
    "noticeTitle",
    "windowStart",
    "windowEnd",
    "sampleCount",
    "avgSpeedKph",
    "avgDelaySeconds",
    "confidence",
    "band",
    "cycleSeconds",
    "phaseCount",
    "laneCount",
    "laneIndex",
    "lineCount",
    "caveat",
    "kind",
    "source",
  ];
  const detailKeys = [...(view.featurePriority ?? []), ...fallbackKeys].filter((key, index, keys) => keys.indexOf(key) === index);
  return {
    title: String(props.label ?? props.name ?? props.id ?? "Selected feature"),
    details: detailKeys
      .filter((key) => props[key] !== undefined && props[key] !== null && props[key] !== "")
      .slice(0, 8)
      .map((key) => [detailLabels[key] ?? key, formatDetail(key, props[key])]),
  };
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function displayArtifact(path: string) {
  return path.replace(/^data\/map-views\//, "");
}

export function FullscreenMapPage({ view, navigate }: FullscreenMapPageProps) {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [styleMode, setStyleMode] = useState<MapStyleMode>("midnight");
  const [activeVariantId, setActiveVariantId] = useState(view.defaultVariantId ?? view.variants?.[0]?.id ?? "");
  const [collections, setCollections] = useState<FeatureCollection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<SelectedFeature | null>(null);
  const [loadedPaths, setLoadedPaths] = useState<string[]>(view.artifactPaths);

  const activeVariant = useMemo(
    () => view.variants?.find((variant) => variant.id === activeVariantId),
    [activeVariantId, view.variants],
  );
  const artifactPaths = activeVariant?.artifactPaths ?? view.artifactPaths;

  useEffect(() => {
    setActiveVariantId(view.defaultVariantId ?? view.variants?.[0]?.id ?? "");
    setSelectedFeature(null);
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    async function loadArtifacts() {
      setError(null);
      setLoadedPaths(artifactPaths);
      try {
        const nextCollections = await Promise.all(
          artifactPaths.map(async (path) => {
            const response = await fetch(normalizePath(path));
            if (!response.ok) throw new Error(`${path} returned ${response.status}`);
            const json = (await response.json()) as FeatureCollection;
            if (json.type !== "FeatureCollection") throw new Error(`${path} is not GeoJSON`);
            return json;
          }),
        );
        if (!cancelled) setCollections(nextCollections);
      } catch (loadError) {
        if (!cancelled) {
          setCollections(artifactPaths.map(() => emptyCollection));
          setError(loadError instanceof Error ? loadError.message : "Map artifact could not be loaded");
        }
      }
    }
    loadArtifacts();
    return () => {
      cancelled = true;
    };
  }, [artifactPaths.join("|")]);

  useEffect(() => {
    let disposed = false;
    async function createMap() {
      if (!mapNode.current) return;
      const { default: maplibregl } = await import("maplibre-gl");
      if (disposed || !mapNode.current) return;
      const map = new maplibregl.Map({
        container: mapNode.current,
        center: view.camera?.center ?? [21.2087, 45.7489],
        zoom: view.camera?.zoom ?? 12,
        pitch: view.camera?.pitch ?? 48,
        bearing: view.camera?.bearing ?? -16,
        maxPitch: 72,
        minZoom: 9,
        style: buildStyle(styleMode, view),
      });
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
      map.on("error", (event) => setError(event.error?.message ?? "Map source error"));
      map.on("click", (event) => {
        const layerIds = (map.getStyle().layers ?? [])
          .filter((layer) => layer.id.includes("-line") || layer.id.includes("-circle"))
          .map((layer) => layer.id);
        const features = map.queryRenderedFeatures(event.point, { layers: layerIds });
        setSelectedFeature(features[0] ? featureDetails(features[0] as Feature<Geometry, GeoJsonProperties>, view) : null);
      });
      mapRef.current = map;
    }
    createMap();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [view.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(buildStyle(styleMode, view));
    map.once("styledata", () => {
      collections.forEach((collection, index) => {
        (map.getSource(`atlas-${index}`) as GeoJSONSource | undefined)?.setData(collection);
      });
    });
  }, [styleMode, view.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !collections.length) return;
    collections.forEach((collection, index) => {
      (map.getSource(`atlas-${index}`) as GeoJSONSource | undefined)?.setData(collection);
    });
    const bounds = mergeBounds(collections);
    if (bounds) {
      map.fitBounds(bounds, { padding: 92, maxZoom: view.layerKind === "point" ? 14.5 : 13.8, duration: 550 });
    }
  }, [collections, view.layerKind]);

  const features = useMemo(() => allFeatures(collections), [collections]);
  const featureCount = features.length;
  const metrics = useMemo(() => metricCandidates(view, features), [view, features]);
  const variantButtons: MapAtlasVariant[] = view.variants ?? [];
  const navigationChips = view.examples.filter((example) => Boolean(example.target));

  return (
    <main className={`map-page atlas-map-page map-mode-${styleMode}`}>
      <div className="map-canvas" ref={mapNode} />
      <div className="map-vignette" />
      <div className="map-style-switcher atlas-style-switcher">
        {mapStyleModes.map((mode) => (
          <button className={styleMode === mode.id ? "active" : ""} key={mode.id} onClick={() => setStyleMode(mode.id)} type="button">
            <strong>{mode.label}</strong>
            <span>{mode.note}</span>
          </button>
        ))}
      </div>
      <section className="atlas-map-title">
        <span>{view.category}</span>
        <h1>{view.title}</h1>
        <p>{view.description}</p>
        {view.insight ? <b>{view.insight}</b> : null}
      </section>
      <div className="atlas-metric-grid">
        {metrics.map((metric) => (
          <span key={metric.label}>
            <strong>{metric.value}</strong>
            <small>{metric.label}</small>
          </span>
        ))}
      </div>
      {variantButtons.length ? (
        <div className="atlas-chip-row atlas-variant-row">
          {variantButtons.map((variant) => (
            <button className={activeVariant?.id === variant.id ? "active" : ""} key={variant.id} onClick={() => setActiveVariantId(variant.id)} type="button">
              {variant.label}
            </button>
          ))}
        </div>
      ) : null}
      {navigationChips.length ? (
        <div className="atlas-chip-row atlas-example-row">
          {navigationChips.map((example) => (
            <button key={`${example.label}-${example.target}`} onClick={() => navigate(example.target as string)} type="button">
              {example.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="atlas-legend">
        {view.legend.map((item) => (
          <span key={item.label}>
            <i style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <div className="atlas-artifact-badge">
        <strong>{featureCount.toLocaleString()} features</strong>
        <span>{loadedPaths.map(displayArtifact).join(" + ")}</span>
      </div>
      {!featureCount && !error ? (
        <div className="atlas-empty-state">
          <strong>No features in this layer</strong>
          <span>{activeVariant?.note ?? view.emptyState ?? "The artifact loaded successfully but contains no renderable features."}</span>
        </div>
      ) : null}
      {selectedFeature ? (
        <div className="atlas-selected-badge">
          <button aria-label="Close selected feature" onClick={() => setSelectedFeature(null)} type="button">
            x
          </button>
          <strong>{selectedFeature.title}</strong>
          {selectedFeature.details.map(([key, value]) => (
            <span key={key}>
              {key}: {value}
            </span>
          ))}
        </div>
      ) : null}
      {error ? <div className="map-error">{error}</div> : null}
    </main>
  );
}

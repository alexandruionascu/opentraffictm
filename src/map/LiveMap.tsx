import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { FeatureCollection, LineString, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { type Scenario, type ActorType } from "../data";
import {
  buildClosureOverlay,
  closureWindowLabel,
  getClosureStatus,
  sortClosureRecords,
  type ClosureManifest,
  type ClosureOverlaySummary,
} from "../closures";
import { simulateScenario, type SimulationFrame } from "../simulation";
import { downloadJson } from "../contracts";

type LineCollection = FeatureCollection<LineString>;
type PointCollection = FeatureCollection<Point>;
type LaneCollection = FeatureCollection<LineString>;
type MapStyleMode = "midnight" | "daylight" | "aerial";

interface LocalOsmBundle {
  roads: LineCollection;
  controls: FeatureCollection<Point>;
  laneBands: LaneCollection;
}

const emptyLineCollection: LineCollection = {
  type: "FeatureCollection",
  features: [],
};

const emptyPointCollection: PointCollection = {
  type: "FeatureCollection",
  features: [],
};

const mapStyleModes: Array<{ id: MapStyleMode; label: string; note: string }> = [
  { id: "midnight", label: "Midnight", note: "dark city mode" },
  { id: "daylight", label: "Daylight", note: "high-contrast streets" },
  { id: "aerial", label: "Satellite", note: "optional imagery basemap" },
];

function getMapTheme(mode: MapStyleMode) {
  switch (mode) {
    case "daylight":
      return {
        background: "#dfe8ef",
        minorRoad: "rgba(77, 98, 118, 0.42)",
        majorHalo: "rgba(248, 250, 252, 0.95)",
        majorRoad: "#35556e",
        majorRoadAlt: "#5b7890",
        laneColor: ["#f59e0b", "#fbbf24", "#fcd34d", "#d97706"],
        closureShadow: "rgba(241, 245, 249, 0.94)",
        closureActive: "#d7263d",
        closureScheduled: "#d97706",
        closureRecent: "#0284c7",
        closureExpired: "#94a3b8",
        crossing: "#be185d",
        signal: "#c026d3",
        signalStroke: "#ffffff",
        actorHalo: "#fb7185",
        actorPrimary: "#2563eb",
        actorSecondary: "#0ea5e9",
        actorText: "#0f172a",
      };
    case "aerial":
      return {
        background: "#0f1a12",
        minorRoad: "rgba(255, 244, 214, 0.22)",
        majorHalo: "rgba(18, 28, 18, 0.94)",
        majorRoad: "#f5e6ba",
        majorRoadAlt: "#d2ff9f",
        laneColor: ["#ffd166", "#f59e0b", "#84cc16", "#22c55e"],
        closureShadow: "rgba(11, 20, 11, 0.94)",
        closureActive: "#ff8c69",
        closureScheduled: "#ffe08a",
        closureRecent: "#93c5fd",
        closureExpired: "#6b8f71",
        crossing: "#ffd6a5",
        signal: "#ff6b6b",
        signalStroke: "#1b2a1c",
        actorHalo: "#ffb703",
        actorPrimary: "#2dd4bf",
        actorSecondary: "#f4d35e",
        actorText: "#f7f7eb",
      };
    default:
      return {
        background: "#06111d",
        minorRoad: "rgba(112, 144, 168, 0.42)",
        majorHalo: "rgba(8, 18, 30, 0.9)",
        majorRoad: "#8aa7bb",
        majorRoadAlt: "#65d6ff",
        laneColor: ["#fde68a", "#fcd34d", "#f59e0b", "#d97706"],
        closureShadow: "rgba(2, 6, 23, 0.92)",
        closureActive: "#ff5c7a",
        closureScheduled: "#fbbf24",
        closureRecent: "#38bdf8",
        closureExpired: "#64748b",
        crossing: "#f472b6",
        signal: "#ff5c7a",
        signalStroke: "#ffffff",
        actorHalo: "#ff5c7a",
        actorPrimary: "#22c55e",
        actorSecondary: "#a3e635",
        actorText: "#edf7ff",
      };
  }
}

function metersPerDegreeLng(lat: number) {
  return Math.cos((lat * Math.PI) / 180) * 111_320;
}

function offsetLineString(
  coordinates: Array<[number, number]>,
  offsetMeters: number,
  reverse = false,
): Array<[number, number]> {
  if (coordinates.length < 2 || offsetMeters === 0) {
    return coordinates.slice();
  }

  const points = reverse ? [...coordinates].reverse() : coordinates;
  const offsets = points.map((point, index) => {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = (next[0] - prev[0]) * metersPerDegreeLng(point[1]);
    const dy = (next[1] - prev[1]) * 111_320;
    const length = Math.hypot(dx, dy) || 1;
    const normalX = (-dy / length) * offsetMeters;
    const normalY = (dx / length) * offsetMeters;
    return [
      point[0] + normalX / metersPerDegreeLng(point[1]),
      point[1] + normalY / 111_320,
    ] as [number, number];
  });

  return reverse ? offsets.reverse() : offsets;
}

function parseLaneCount(value: unknown, rank: number) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(1, Math.min(4, Math.round(parsed)));
  }

  return rank >= 7 ? 2 : 1;
}

function laneOverlayGeoJson(roads: LineCollection): LaneCollection {
  const features = roads.features.flatMap((feature) => {
    const lanes = parseLaneCount(feature.properties?.lanes, feature.properties?.rank ?? 0);
    if (lanes < 2 || feature.geometry.coordinates.length < 2) {
      return [];
    }

    const center = (lanes - 1) / 2;
    const reverse = String(feature.properties?.oneway ?? "") === "-1";

    return Array.from({ length: lanes }, (_, laneIndex) => {
      const offsetMeters = (laneIndex - center) * 3.4;
      return {
        type: "Feature" as const,
        id: `${feature.id ?? feature.properties?.osmId ?? "road"}:lane-${laneIndex}`,
        properties: {
          osmId: feature.properties?.osmId ?? null,
          name: feature.properties?.name ?? null,
          highway: feature.properties?.highway ?? null,
          rank: feature.properties?.rank ?? 0,
          laneIndex,
          laneCount: lanes,
          offsetMeters,
        },
        geometry: {
          type: "LineString" as const,
          coordinates: offsetLineString(
            feature.geometry.coordinates as Array<[number, number]>,
            offsetMeters,
            reverse,
          ),
        },
      };
    });
  });

  return { type: "FeatureCollection", features };
}

function routeGeoJson(scenario: Scenario): FeatureCollection<LineString> {
  const uniqueRoutes = new Map<string, Scenario["actors"][number]["route"]>();

  for (const actor of scenario.actors) {
    if (actor.type === "pedestrian") continue;
    const key = actor.route.map((point) => `${point.lng.toFixed(5)},${point.lat.toFixed(5)}`).join("|");
    uniqueRoutes.set(key, actor.route);
  }

  return {
    type: "FeatureCollection",
    features: [...uniqueRoutes.values()].map((route, index) => ({
      type: "Feature",
      properties: { id: `route-${index}` },
      geometry: {
        type: "LineString",
        coordinates: route.map((point) => [point.lng, point.lat]),
      },
    })),
  };
}

function actorGeoJson(frame: SimulationFrame): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: frame.actors.map((actor) => ({
      type: "Feature",
      properties: {
        id: actor.id,
        type: actor.type,
        waiting: actor.waiting,
        congestion: actor.congestion,
        stoppedFor: actor.stoppedFor ?? "",
        laneIndex: actor.laneIndex,
      },
      geometry: {
        type: "Point",
        coordinates: [actor.position.lng, actor.position.lat],
      },
    })),
  };
}

function actorHeadingGeoJson(frame: SimulationFrame): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: frame.actors
      .filter((actor) => actor.type !== "pedestrian")
      .map((actor) => {
        const lengthMeters = actor.type === "bus" ? 18 : 10;
        const headingRad = (actor.headingDeg * Math.PI) / 180;
        const latScale = 111_320;
        const lngScale = Math.cos((actor.position.lat * Math.PI) / 180) * latScale;
        const end = {
          lng: actor.position.lng + (Math.sin(headingRad) * lengthMeters) / lngScale,
          lat: actor.position.lat + (Math.cos(headingRad) * lengthMeters) / latScale,
        };

        return {
          type: "Feature",
          properties: {
            id: actor.id,
            type: actor.type,
            waiting: actor.waiting,
            congestion: actor.congestion,
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [actor.position.lng, actor.position.lat],
              [end.lng, end.lat],
            ],
          },
        };
      }),
  };
}

function coordinateAtBearing(origin: { lng: number; lat: number }, headingDeg: number, distanceMeters: number) {
  const headingRad = (headingDeg * Math.PI) / 180;
  const latScale = 111_320;
  const lngScale = Math.cos((origin.lat * Math.PI) / 180) * latScale;

  return {
    lng: origin.lng + (Math.sin(headingRad) * distanceMeters) / lngScale,
    lat: origin.lat + (Math.cos(headingRad) * distanceMeters) / latScale,
  };
}

function signalPhaseGeoJson(frame: SimulationFrame): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: frame.signals
      .filter((signal) => signal.primaryHeadingDeg !== undefined)
      .map((signal) => {
        const activeHeading =
          signal.state === "red" ? (signal.primaryHeadingDeg ?? 0) + 90 : signal.primaryHeadingDeg ?? 0;
        const start = coordinateAtBearing(signal.position, activeHeading + 180, 38);
        const end = coordinateAtBearing(signal.position, activeHeading, 38);

        return {
          type: "Feature",
          properties: { id: signal.id, state: signal.state },
          geometry: {
            type: "LineString",
            coordinates: [
              [start.lng, start.lat],
              [end.lng, end.lat],
            ],
          },
        };
      }),
  };
}

function signalGeoJson(frame: SimulationFrame): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: frame.signals.map((signal) => ({
      type: "Feature",
      properties: {
        id: signal.id,
        state: signal.state,
        primaryHeadingDeg: signal.primaryHeadingDeg ?? 0,
      },
      geometry: {
        type: "Point",
        coordinates: [signal.position.lng, signal.position.lat],
      },
    })),
  };
}

function buildMapStyle(mode: MapStyleMode, localOsm: LocalOsmBundle | null): StyleSpecification {
  const theme = getMapTheme(mode);
  const isAerial = mode === "aerial";
  const roads = localOsm?.roads ?? emptyLineCollection;
  const controls = localOsm?.controls ?? emptyPointCollection;
  const laneBands = localOsm?.laneBands ?? emptyLineCollection;

  return {
    version: 8,
    sources: {
      ...(isAerial
        ? {
            "aerial-imagery": {
              type: "raster",
              tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
              tileSize: 256,
              attribution: "Esri World Imagery",
            },
          }
        : {}),
      "local-roads": { type: "geojson", data: roads, attribution: "OpenStreetMap contributors" },
      "local-osm-controls": { type: "geojson", data: controls },
      "local-road-lanes": { type: "geojson", data: laneBands },
      "local-road-closures": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": isAerial ? "#0a1210" : theme.background } },
      ...(isAerial
        ? [
            {
              id: "aerial-imagery",
              type: "raster",
              source: "aerial-imagery",
              paint: {
                "raster-opacity": 1,
                "raster-brightness-min": 0.08,
                "raster-brightness-max": 0.92,
                "raster-saturation": 0.12,
                "raster-resampling": "linear",
              },
            } as const,
          ]
        : []),
      {
        id: "local-roads-minor",
        type: "line",
        source: "local-roads",
        filter: ["<", ["get", "rank"], 5],
        paint: {
          "line-color": isAerial ? "rgba(255, 244, 214, 0.26)" : theme.minorRoad,
          "line-width": isAerial
            ? ["interpolate", ["linear"], ["zoom"], 10, 0.15, 13, 0.5, 16, 1.4]
            : ["interpolate", ["linear"], ["zoom"], 10, 0.25, 13, 0.75, 16, 2.2],
        },
      },
      {
        id: "local-roads-major-halo",
        type: "line",
        source: "local-roads",
        filter: [">=", ["get", "rank"], 5],
        paint: {
          "line-color": isAerial ? "rgba(10, 16, 12, 0.9)" : theme.majorHalo,
          "line-width": isAerial
            ? ["interpolate", ["linear"], ["zoom"], 10, 2, 13, 4.5, 16, 9]
            : ["interpolate", ["linear"], ["zoom"], 10, 2.4, 13, 5.5, 16, 12],
        },
      },
      {
        id: "local-roads-major",
        type: "line",
        source: "local-roads",
        filter: [">=", ["get", "rank"], 5],
        paint: {
          "line-color": [
            "interpolate",
            ["linear"],
            ["get", "rank"],
            5,
            theme.majorRoad,
            7,
            theme.majorRoadAlt,
            9,
            isAerial ? "#f8f1d6" : "#ffd166",
          ],
          "line-width": isAerial
            ? ["interpolate", ["linear"], ["zoom"], 10, 0.8, 13, 1.9, 16, 4.6]
            : ["interpolate", ["linear"], ["zoom"], 10, 1, 13, 2.4, 16, 6],
          "line-opacity": isAerial ? 0.9 : 0.92,
        },
      },
      {
        id: "local-road-lanes",
        type: "line",
        source: "local-road-lanes",
        paint: {
          "line-color": ["match", ["get", "laneIndex"], 0, theme.laneColor[0], 1, theme.laneColor[1], 2, theme.laneColor[2], theme.laneColor[3]],
          "line-width": isAerial
            ? ["interpolate", ["linear"], ["zoom"], 10, 0.55, 13, 1.1, 16, 2.2]
            : ["interpolate", ["linear"], ["zoom"], 10, 0.8, 13, 1.6, 16, 3.1],
          "line-opacity": isAerial ? 0.45 : 0.5,
          "line-dasharray": [1.1, 1.8],
        },
      },
      {
        id: "local-road-closures-shadow",
        type: "line",
        source: "local-road-closures",
        paint: {
          "line-color": theme.closureShadow,
          "line-width": ["match", ["get", "status"], "active", 9, "scheduled", 8, "recently-cleared", 7, 6],
          "line-opacity": 0.88,
        },
      },
      {
        id: "local-road-closures-active",
        type: "line",
        source: "local-road-closures",
        filter: ["==", ["get", "status"], "active"],
        paint: { "line-color": theme.closureActive, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 16, 8], "line-opacity": 0.95 },
      },
      {
        id: "local-road-closures-scheduled",
        type: "line",
        source: "local-road-closures",
        filter: ["==", ["get", "status"], "scheduled"],
        paint: { "line-color": theme.closureScheduled, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 7], "line-opacity": 0.82 },
      },
      {
        id: "local-road-closures-recent",
        type: "line",
        source: "local-road-closures",
        filter: ["==", ["get", "status"], "recently-cleared"],
        paint: { "line-color": theme.closureRecent, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.5, 16, 6], "line-opacity": 0.68 },
      },
      {
        id: "local-road-closures-expired",
        type: "line",
        source: "local-road-closures",
        filter: ["==", ["get", "status"], "expired"],
        paint: { "line-color": theme.closureExpired, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 16, 5], "line-opacity": 0.3 },
      },
      {
        id: "local-road-closures-labels",
        type: "symbol",
        source: "local-road-closures",
        minzoom: 13.6,
        layout: {
          "symbol-placement": "line",
          "text-field": ["concat", ["get", "statusLabel"], " · ", ["get", "roadName"]],
          "text-size": 9,
          "text-allow-overlap": false,
        },
        paint: { "text-color": isAerial ? "#fff7e6" : "#ffffff", "text-halo-color": isAerial ? "#08110c" : theme.background, "text-halo-width": 1.4 },
      },
      {
        id: "local-crossings",
        type: "circle",
        source: "local-osm-controls",
        filter: ["==", ["get", "kind"], "crossing"],
        paint: {
          "circle-radius": isAerial ? ["interpolate", ["linear"], ["zoom"], 12, 0.8, 16, 2] : ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 3],
          "circle-color": isAerial ? "#ffb86c" : theme.crossing,
          "circle-opacity": 0.7,
        },
      },
      {
        id: "local-traffic-signals",
        type: "circle",
        source: "local-osm-controls",
        filter: ["==", ["get", "kind"], "traffic_signal"],
        paint: {
          "circle-radius": isAerial ? ["interpolate", ["linear"], ["zoom"], 11, 1.5, 16, 4] : ["interpolate", ["linear"], ["zoom"], 11, 2, 16, 5],
          "circle-color": isAerial ? "#ff5c7a" : theme.signal,
          "circle-stroke-color": theme.signalStroke,
          "circle-stroke-width": 0.8,
          "circle-opacity": 0.86,
        },
      },
    ],
  };
}

function attachDynamicMapLayers(
  map: MapLibreMap,
  scenario: Scenario,
  frame: SimulationFrame,
  stptVehicles: PointCollection,
  closures: ClosureManifest | null,
  roads: LineCollection,
) {
  if (map.getSource("actors")) return;

  map.addSource("actors", { type: "geojson", data: actorGeoJson(frame) });
  map.addSource("actor-headings", { type: "geojson", data: actorHeadingGeoJson(frame) });
  map.addSource("scenario-routes", { type: "geojson", data: routeGeoJson(scenario) });
  map.addSource("signal-phases", { type: "geojson", data: signalPhaseGeoJson(frame) });
  map.addSource("stpt-vehicles", { type: "geojson", data: stptVehicles });

  map.addLayer({
    id: "scenario-routes",
    type: "line",
    source: "scenario-routes",
    paint: {
      "line-color": "rgba(101, 214, 255, 0.5)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 15, 4],
      "line-dasharray": [1, 2],
      "line-opacity": 0.7,
    },
  });
  map.addLayer({
    id: "signal-phase-axes",
    type: "line",
    source: "signal-phases",
    paint: {
      "line-color": ["match", ["get", "state"], "green", "#86efac", "yellow", "#fbbf24", "#fb7185"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 15, 7],
      "line-opacity": 0.62,
      "line-blur": 0.6,
    },
  });
  const closureOverlay = buildClosureOverlay(roads, closures?.records ?? []);
  map.addLayer({
    id: "actor-queue-halo",
    type: "circle",
    source: "actors",
    filter: ["==", ["get", "waiting"], true],
    paint: {
      "circle-radius": ["match", ["get", "type"], "bus", 18, "pedestrian", 10, 13],
      "circle-color": "#ff5c7a",
      "circle-opacity": ["interpolate", ["linear"], ["get", "congestion"], 0, 0.18, 1, 0.48],
      "circle-blur": 0.4,
    },
  });
  map.addLayer({
    id: "actors",
    type: "circle",
    source: "actors",
    paint: {
      "circle-radius": ["match", ["get", "type"], "bus", 11, "pedestrian", 5, 7],
      "circle-color": [
        "case",
        ["==", ["get", "waiting"], true],
        "#ff5c7a",
        [">", ["get", "congestion"], 0.4],
        "#fb923c",
        ["match", ["get", "type"], "bus", "#fbbf24", "pedestrian", "#f472b6", "#7dd3fc"],
      ],
      "circle-stroke-color": "#031018",
      "circle-stroke-width": 2,
      "circle-blur": 0.1,
    },
  });
  map.addLayer({
    id: "actor-lane-tags",
    type: "symbol",
    source: "actors",
    minzoom: 15,
    layout: {
      "text-field": ["concat", "L", ["to-string", ["get", "laneIndex"]]],
      "text-size": 9,
      "text-offset": [1.25, -1],
      "text-anchor": "left",
    },
    paint: { "text-color": "#fde68a", "text-halo-color": "#031018", "text-halo-width": 1.2 },
  });
  map.addLayer({
    id: "actor-headings",
    type: "line",
    source: "actor-headings",
    paint: {
      "line-color": ["match", ["get", "type"], "bus", "#ffd166", "pedestrian", "#f472b6", "#65d6ff"],
      "line-width": ["match", ["get", "type"], "bus", 4, "pedestrian", 1.5, 2.5],
      "line-opacity": 0.85,
    },
  });
  map.addLayer({
    id: "actor-labels",
    type: "symbol",
    source: "actors",
    minzoom: 14.2,
    layout: {
      "text-field": ["match", ["get", "type"], "bus", "BUS", "pedestrian", "PED", "CAR"],
      "text-size": ["match", ["get", "type"], "bus", 11, "pedestrian", 9, 10],
      "text-offset": [0, 1.15],
      "text-anchor": "top",
    },
    paint: { "text-color": "#edf7ff", "text-halo-color": "#031018", "text-halo-width": 1.5 },
  });
  map.addLayer({
    id: "stpt-vehicle-halo",
    type: "circle",
    source: "stpt-vehicles",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 7, 15, 14],
      "circle-color": "#22c55e",
      "circle-opacity": 0.18,
      "circle-blur": 0.35,
    },
  });
  map.addLayer({
    id: "stpt-vehicles",
    type: "circle",
    source: "stpt-vehicles",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 15, 7],
      "circle-color": ["case", [">", ["get", "speed"], 0], "#22c55e", "#a3e635"],
      "circle-stroke-color": "#052e16",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: "stpt-vehicle-labels",
    type: "symbol",
    source: "stpt-vehicles",
    minzoom: 13.6,
    layout: {
      "text-field": ["concat", "STPT ", ["to-string", ["get", "route"]]],
      "text-size": 10,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
    },
    paint: { "text-color": "#edf7ff", "text-halo-color": "#052e16", "text-halo-width": 1.4 },
  });
  map.addSource("signals", { type: "geojson", data: signalGeoJson(frame) });
  map.addLayer({
    id: "signals",
    type: "circle",
    source: "signals",
    paint: {
      "circle-radius": 8,
      "circle-color": ["match", ["get", "state"], "green", "#86efac", "yellow", "#fbbf24", "#fb7185"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });

  (map.getSource("local-road-closures") as GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features: closureOverlay.features,
  });
}

function updateClosureOverlay(map: MapLibreMap, roads: LineCollection, closures: ClosureManifest | null) {
  const overlay = closures ? buildClosureOverlay(roads, closures.records) : null;
  (map.getSource("local-road-closures") as GeoJSONSource | undefined)?.setData(
    overlay ? { type: "FeatureCollection", features: overlay.features } : { type: "FeatureCollection", features: [] },
  );
}

export function LiveMap({ scenarios }: { scenarios: Scenario[] }) {
  const [selectedScenarioId, setSelectedScenarioId] = useState(scenarios[0]?.id ?? "");
  const scenario = useMemo(
    () => scenarios.find((entry) => entry.id === selectedScenarioId) ?? scenarios[0],
    [scenarios, selectedScenarioId],
  );
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1.5);
  const [time, setTime] = useState(0);
  const [demoMode, setDemoMode] = useState(true);
  const [stptVehicles, setStptVehicles] = useState<PointCollection>(emptyPointCollection);
  const [closures, setClosures] = useState<ClosureManifest | null>(null);
  const lastFrameAt = useRef(0);

  const frame = useMemo(() => simulateScenario(scenario, time), [scenario, time]);

  useEffect(() => {
    if (!demoMode) return;
    setSelectedScenarioId(scenarios[0]?.id ?? "");
    setTime(0);
    setRunning(true);
    setSpeed(1.5);
  }, [demoMode, scenarios]);

  useEffect(() => {
    setTime(0);
    lastFrameAt.current = 0;
  }, [scenario.id]);

  useEffect(() => {
    let disposed = false;

    async function loadStptVehicles() {
      const fetchGeoJson = async () => {
        const response = await fetch(`/data/sources/stpt-live/latest-vehicles.geojson?t=${Date.now()}`);
        if (!response.ok) throw new Error("geojson unavailable");
        return (await response.json()) as PointCollection;
      };

      const fetchJson = async () => {
        const response = await fetch(`/data/sources/stpt-live/latest-vehicles.json?t=${Date.now()}`);
        if (!response.ok) throw new Error("json unavailable");
        const json = (await response.json()) as {
          features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: { speed?: number; route?: string | number } }>;
        };
        return {
          type: "FeatureCollection",
          features:
            json.features?.map((feature, index) => ({
              type: "Feature" as const,
              properties: {
                route: feature.properties?.route ?? index + 1,
                speed: feature.properties?.speed ?? 0,
              },
              geometry: {
                type: "Point" as const,
                coordinates: feature.geometry?.coordinates ?? [scenario.center.lng, scenario.center.lat],
              },
            })) ?? [],
        } as PointCollection;
      };

      try {
        const geojson = await fetchGeoJson().catch(fetchJson);
        if (!disposed) setStptVehicles(geojson);
      } catch {
        if (!disposed) setStptVehicles(emptyPointCollection);
      }
    }

    void loadStptVehicles();
    const interval = window.setInterval(loadStptVehicles, 30_000);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [scenario.center.lat, scenario.center.lng]);

  useEffect(() => {
    let disposed = false;

    async function loadClosures() {
      try {
        const response = await fetch(`/data/sources/timisoara-road-closures/latest.json?t=${Date.now()}`);
        if (!response.ok) return;
        const json = (await response.json()) as ClosureManifest;
        if (!disposed) setClosures(json);
      } catch {
        if (!disposed) setClosures(null);
      }
    }

    void loadClosures();
    const interval = window.setInterval(loadClosures, 10 * 60 * 1000);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!running) return undefined;

    const startedAt = performance.now();
    const initialTime = time;
    let raf = 0;

    const tick = (now: number) => {
      if (now - lastFrameAt.current >= 50) {
        const elapsed = ((now - startedAt) / 1000) * speed;
        setTime((initialTime + elapsed) % scenario.durationSeconds);
        lastFrameAt.current = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, scenario.durationSeconds, speed]);

  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const roadsRef = useRef<LineCollection | null>(null);
  const stptVehiclesRef = useRef(stptVehicles);
  const frameRef = useRef(frame);
  const scenarioRef = useRef(scenario);
  const closuresRef = useRef(closures);
  const currentStyleModeRef = useRef<MapStyleMode>("midnight");
  const styleReloadsEnabledRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<MapStyleMode>("midnight");
  const [localOsm, setLocalOsm] = useState<LocalOsmBundle | null>(null);

  useEffect(() => {
    stptVehiclesRef.current = stptVehicles;
  }, [stptVehicles]);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);
  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);
  useEffect(() => {
    closuresRef.current = closures;
  }, [closures]);

  useEffect(() => {
    let disposed = false;
    let osmLoadPromise: Promise<LocalOsmBundle> | null = null;

    async function loadLocalOsm() {
      const [roadsResponse, controlsResponse] = await Promise.all([
        fetch("/data/osm/timisoara-roads.geojson"),
        fetch("/data/osm/timisoara-controls.geojson"),
      ]);

      if (!roadsResponse.ok || !controlsResponse.ok) {
        throw new Error("Local Timișoara OSM files could not be loaded from data/osm.");
      }

      const roads = (await roadsResponse.json()) as LineCollection;
      const controls = (await controlsResponse.json()) as FeatureCollection<Point>;
      const laneBands = laneOverlayGeoJson(roads);
      roadsRef.current = roads;
      return { roads, controls, laneBands };
    }

    async function attachLocalOsm(map: MapLibreMap) {
      try {
        osmLoadPromise ??= loadLocalOsm();
        const osm = await osmLoadPromise;
        if (disposed) return;
        setLocalOsm(osm);

        (map.getSource("local-roads") as GeoJSONSource | undefined)?.setData(osm.roads);
        (map.getSource("local-osm-controls") as GeoJSONSource | undefined)?.setData(osm.controls);
        (map.getSource("local-road-lanes") as GeoJSONSource | undefined)?.setData(osm.laneBands);
        updateClosureOverlay(map, osm.roads, closuresRef.current);
      } catch (error) {
        if (!disposed) {
          setMapError(error instanceof Error ? error.message : "Local OSM data could not be loaded");
        }
      }
    }

    async function loadMap() {
      if (disposed || !mapNode.current) return;

      setMapReady(false);
      setMapError(null);
      const { default: maplibregl } = await import("maplibre-gl");
      if (disposed) return;

      const map = new maplibregl.Map({
        container: mapNode.current,
        center: [scenario.center.lng, scenario.center.lat],
        zoom: scenario.zoom,
        pitch: 58,
        bearing: -18,
        maxPitch: 75,
        minZoom: 10,
        style: buildMapStyle(currentStyleModeRef.current, null),
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
      map.on("error", (event) => {
        setMapError(event.error?.message ?? "Map source error");
      });

      const syncDynamicLayers = () => {
        if (!map.getSource("actors")) {
          attachDynamicMapLayers(
            map,
            scenarioRef.current,
            frameRef.current,
            stptVehiclesRef.current,
            closuresRef.current,
            roadsRef.current ?? emptyLineCollection,
          );
          setMapReady(true);
          return;
        }

        (map.getSource("actors") as GeoJSONSource | undefined)?.setData(actorGeoJson(frameRef.current));
        (map.getSource("actor-headings") as GeoJSONSource | undefined)?.setData(actorHeadingGeoJson(frameRef.current));
        (map.getSource("signals") as GeoJSONSource | undefined)?.setData(signalGeoJson(frameRef.current));
        (map.getSource("signal-phases") as GeoJSONSource | undefined)?.setData(signalPhaseGeoJson(frameRef.current));
        (map.getSource("stpt-vehicles") as GeoJSONSource | undefined)?.setData(stptVehiclesRef.current);
        updateClosureOverlay(map, roadsRef.current ?? emptyLineCollection, closuresRef.current);
      };

      map.on("style.load", () => {
        if (!styleReloadsEnabledRef.current) return;
        syncDynamicLayers();
      });

      osmLoadPromise ??= loadLocalOsm();
      map.once("load", () => {
        styleReloadsEnabledRef.current = true;
        setMapReady(true);
        syncDynamicLayers();
        void attachLocalOsm(map);
      });

      mapRef.current = map;
    }

    void loadMap().catch((error) => {
      setMapError(error instanceof Error ? error.message : "Map renderer failed to initialize");
      setMapReady(false);
    });

    return () => {
      disposed = true;
      styleReloadsEnabledRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [scenario]);

  useEffect(() => {
    const map = mapRef.current;
    const osm = localOsm;
    const previousMode = currentStyleModeRef.current;
    if (!map || !osm || previousMode === mapMode) return;
    currentStyleModeRef.current = mapMode;
    map.setStyle(buildMapStyle(mapMode, osm));
  }, [localOsm, mapMode]);

  useEffect(() => {
    (mapRef.current?.getSource("actors") as GeoJSONSource | undefined)?.setData(actorGeoJson(frame));
    (mapRef.current?.getSource("actor-headings") as GeoJSONSource | undefined)?.setData(actorHeadingGeoJson(frame));
    (mapRef.current?.getSource("signals") as GeoJSONSource | undefined)?.setData(signalGeoJson(frame));
    (mapRef.current?.getSource("signal-phases") as GeoJSONSource | undefined)?.setData(signalPhaseGeoJson(frame));
  }, [frame]);

  useEffect(() => {
    (mapRef.current?.getSource("stpt-vehicles") as GeoJSONSource | undefined)?.setData(stptVehicles);
  }, [stptVehicles]);

  useEffect(() => {
    const map = mapRef.current;
    const roads = roadsRef.current;
    if (!map || !roads) return;
    updateClosureOverlay(map, roads, closures);
  }, [closures, mapReady]);

  const exportTrace = () => {
    downloadJson(`opentraffictm-trace-${scenario.id}.json`, {
      generatedAt: new Date().toISOString(),
      kind: "simulation-trace",
      version: 1,
      payload: {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        timeSeconds: frame.timeSeconds,
        metrics: frame.metrics,
        signalComparisons: frame.signalComparisons,
        actors: frame.actors,
        signals: frame.signals,
      },
    });
  };

  const exportScenario = () => {
    downloadJson(`opentraffictm-scenario-${scenario.id}.json`, {
      generatedAt: new Date().toISOString(),
      kind: "scenario-export",
      version: 1,
      payload: scenario,
    });
  };

  return (
    <main className="map-page">
      <LiveMapViewport
        scenario={scenario}
        frame={frame}
        stptVehicles={stptVehicles}
        closures={closures}
        mapNode={mapNode}
        mapMode={mapMode}
        setMapMode={setMapMode}
        mapReady={mapReady}
        mapError={mapError}
      />
      <aside className="sim-panel">
        <p className="eyebrow">Live environment</p>
        <h2>{scenario.name}</h2>
        <p>{scenario.description}</p>
        <div className="toolbar">
          <button className="btn primary" onClick={() => setRunning((value) => !value)} type="button">
            {running ? "Pause" : "Play"}
          </button>
          <button
            className="btn secondary"
            onClick={() => {
              setRunning(false);
              setTime(0);
            }}
            type="button"
          >
            Reset
          </button>
          <button className="btn secondary" onClick={exportTrace} type="button">
            Export trace
          </button>
          <button className="btn secondary" onClick={exportScenario} type="button">
            Export scenario
          </button>
        </div>
        <div className="toolbar">
          <label className="switch">
            <input checked={demoMode} onChange={(event) => setDemoMode(event.target.checked)} type="checkbox" />
            <span>Demo mode</span>
          </label>
          <select onChange={(event) => setSpeed(Number(event.target.value))} value={speed}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </div>
        <div className="scenario-picker">
          {scenarios.map((entry) => (
            <button
              className={entry.id === scenario.id ? "scenario-chip active" : "scenario-chip"}
              key={entry.id}
              onClick={() => setSelectedScenarioId(entry.id)}
              type="button"
            >
              <strong>{entry.name}</strong>
              <span>{entry.district}</span>
            </button>
          ))}
        </div>
        <div className="metrics-grid">
          <Metric value={String(frame.metrics.activeActors)} label="active actors" />
          <Metric value={String(frame.metrics.queueLength)} label="queued at signals" />
          <Metric value={frame.metrics.averageSpeedKmh.toFixed(1)} label="avg km/h" />
          <Metric value={`${Math.round(time)}s`} label="simulation clock" />
          <Metric value={String(frame.metrics.signalPressure)} label="signal pressure" />
          <Metric value={String(closures?.recordCount ?? 0)} label="closure notices" />
        </div>
        <div className="signal-comparison">
          {frame.signalComparisons.map((signal) => (
            <article className="signal-comparison-card" key={signal.id}>
              <div>
                <strong>{signal.name}</strong>
                <small>{signal.state.toUpperCase()} · {signal.secondsRemaining}s left</small>
              </div>
              <div>
                <span>{signal.blockedActors} blocked</span>
                <span>{signal.queueMeters.toFixed(0)}m queue</span>
                <span>{signal.estimatedDelaySeconds.toFixed(1)}s delay</span>
              </div>
            </article>
          ))}
        </div>
        {closures?.records.length ? <ClosureSidebar closures={closures} /> : null}
      </aside>
      <div className="timeline">
        <span>Browser-native deterministic model</span>
        <div>
          <b>SUMO adapter</b>
          <span> planned</span>
        </div>
        <div>
          <b>Satellite mode</b>
          <span> optional imagery</span>
        </div>
      </div>
    </main>
  );
}

function LiveMapViewport({
  scenario,
  frame,
  stptVehicles,
  closures,
  mapNode,
  mapMode,
  setMapMode,
  mapReady,
  mapError,
}: {
  scenario: Scenario;
  frame: SimulationFrame;
  stptVehicles: PointCollection;
  closures: ClosureManifest | null;
  mapNode: RefObject<HTMLDivElement | null>;
  mapMode: MapStyleMode;
  setMapMode: (mode: MapStyleMode) => void;
  mapReady: boolean;
  mapError: string | null;
}) {
  return (
    <div className={`map-canvas map-mode-${mapMode}`}>
      <div className="maplibre-node" ref={mapNode} />
      <div className="map-style-switcher" role="tablist" aria-label="Map styles">
        {mapStyleModes.map((mode) => (
          <button
            className={mapMode === mode.id ? "active" : ""}
            key={mode.id}
            onClick={() => setMapMode(mode.id)}
            role="tab"
            aria-selected={mapMode === mode.id}
            type="button"
          >
            <strong>{mode.label}</strong>
            <span>{mode.note}</span>
          </button>
        ))}
      </div>
      {!mapReady ? <FallbackMap scenario={scenario} frame={frame} /> : null}
      {mapError ? <div className="map-error">{mapError}</div> : null}
      <div className="map-vignette" />
      <ActorLegend frame={frame} stptVehicleCount={stptVehicles.features.length} />
      {closures?.records.length ? <MiniClosureBadge closures={closures} /> : null}
    </div>
  );
}

function FallbackMap({ scenario, frame }: { scenario: Scenario; frame: SimulationFrame }) {
  return (
    <div className="fallback-map">
      <div className="fallback-grid" />
      <div className="fallback-grid secondary" />
      <div className="fallback-road road-a" />
      <div className="fallback-road road-b" />
      <div className="fallback-road road-c" />
      <div className="fallback-road road-d" />
      {frame.actors.map((actor) => (
        <div
          className={`actor actor-${actor.type} ${actor.waiting ? "waiting" : ""}`}
          key={actor.id}
          style={{
            left: `${18 + actor.progress * 66}%`,
            top: `${actor.type === "pedestrian" ? 58 : 28 + actor.progress * 42}%`,
            transform: `rotate(${actor.headingDeg}deg)`,
          }}
          title={actor.label}
        />
      ))}
      {frame.signals.map((signal, index) => (
        <div
          className={`fallback-signal ${signal.state}`}
          key={signal.id}
          style={{ left: `${40 + index * 14}%`, top: `${34 + index * 10}%` }}
          title={`${signal.name} · ${signal.state}`}
        />
      ))}
      <div className="fallback-caption">
        <strong>{scenario.name}</strong>
        <span>Offline-safe fallback with local simulation overlays only</span>
      </div>
    </div>
  );
}

function ActorLegend({
  frame,
  stptVehicleCount,
}: {
  frame: SimulationFrame;
  stptVehicleCount: number;
}) {
  const counts = frame.actors.reduce<Record<ActorType, number>>(
    (total, actor) => {
      total[actor.type] += 1;
      return total;
    },
    { car: 0, bus: 0, pedestrian: 0 },
  );

  return (
    <div className="actor-legend">
      <span>
        <i className="legend-dot actor-car" />
        {counts.car} cars
      </span>
      <span>
        <i className="legend-dot actor-bus" />
        {counts.bus} buses
      </span>
      <span>
        <i className="legend-dot actor-pedestrian" />
        {counts.pedestrian} pedestrians
      </span>
      <span>
        <i className="legend-dot waiting-dot" />
        {frame.metrics.waitingActors} waiting
      </span>
      <span>
        <i className="legend-dot stpt-dot" />
        {stptVehicleCount} real STPT
      </span>
      <span>
        <i className="legend-dot lane-dot" />
        lanes
      </span>
    </div>
  );
}

function ClosureSidebar({ closures }: { closures: ClosureManifest }) {
  const summary = closures.records.reduce<ClosureOverlaySummary>(
    (counts, record) => {
      const status = getClosureStatus(record).status;
      counts.total += 1;
      if (status === "active") counts.active += 1;
      if (status === "scheduled") counts.scheduled += 1;
      if (status === "recently-cleared") counts.recentlyCleared += 1;
      if (status === "expired") counts.expired += 1;
      return counts;
    },
    { active: 0, scheduled: 0, recentlyCleared: 0, expired: 0, total: 0 },
  );
  const records = sortClosureRecords(closures.records).slice(0, 6);

  return (
    <section className="closure-panel">
      <div className="closure-panel-head">
        <div>
          <strong>Road closures</strong>
          <small>Local municipal notices with time windows</small>
        </div>
        <div className="closure-panel-stats">
          <span>{summary.active} active</span>
          <span>{summary.scheduled} scheduled</span>
        </div>
      </div>
      <div className="closure-panel-key">
        <span><i className="closure-dot active" />active</span>
        <span><i className="closure-dot scheduled" />scheduled</span>
        <span><i className="closure-dot recently-cleared" />recently cleared</span>
        <span><i className="closure-dot expired" />expired</span>
      </div>
      <div className="closure-list">
        {records.map((record) => {
          const status = getClosureStatus(record);
          return (
            <article className="closure-item" key={record.url}>
              <span className={`closure-dot ${status.status}`} />
              <div>
                <strong>{record.title}</strong>
                <small>
                  {status.label} · {closureWindowLabel(record)}
                </small>
                <small className="closure-roads">
                  {record.roads.slice(0, 3).join(" · ") || "Road names extracted from the notice"}
                </small>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function MiniClosureBadge({ closures }: { closures: ClosureManifest }) {
  const active = closures.records.filter((record) => getClosureStatus(record).status === "active").length;
  return <div className="mini-badge">{active} active closures</div>;
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

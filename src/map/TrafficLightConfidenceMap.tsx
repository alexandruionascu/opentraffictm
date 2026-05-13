import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { TrafficLightIntersectionCandidate } from "../contracts";

export interface TrafficProbePoint {
  lng: number;
  lat: number;
  t: number;
  speed: number;
  stop: string;
}

export interface TrafficProbeTrack {
  id: string;
  route: string;
  vehicleId: string;
  points: TrafficProbePoint[];
}

export interface TrafficHistoricalPlace {
  name: string;
  lng: number;
  lat: number;
  samples: number;
  waitingSamples: number;
}

interface LocalRoads {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "LineString"; coordinates: number[][] };
    properties?: Record<string, unknown>;
  }>;
}

type JsonFeatureCollection = { type: "FeatureCollection"; features: Array<Record<string, unknown>> };

function emptyGeoJson(): JsonFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      "local-roads": { type: "geojson", data: emptyGeoJson() as never, attribution: "OpenStreetMap contributors" },
      "local-controls": { type: "geojson", data: emptyGeoJson() as never },
      "historical-tracks": { type: "geojson", data: emptyGeoJson() as never },
      "waiting-evidence": { type: "geojson", data: emptyGeoJson() as never },
      "moving-evidence": { type: "geojson", data: emptyGeoJson() as never },
      "candidate-confidence": { type: "geojson", data: emptyGeoJson() as never },
      "historical-places": { type: "geojson", data: emptyGeoJson() as never },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#e8f0e8" } },
      {
        id: "local-roads-minor-halo",
        type: "line",
        source: "local-roads",
        filter: ["<", ["get", "rank"], 5],
        paint: {
          "line-color": "#cfdbd2",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 13, 1.8, 16, 5],
          "line-opacity": 0.7,
        },
      },
      {
        id: "local-roads-minor",
        type: "line",
        source: "local-roads",
        filter: ["<", ["get", "rank"], 5],
        paint: {
          "line-color": "#fbfbf6",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.45, 13, 1.1, 16, 3.2],
          "line-opacity": 0.92,
        },
      },
      {
        id: "local-roads-major-halo",
        type: "line",
        source: "local-roads",
        filter: [">=", ["get", "rank"], 5],
        paint: {
          "line-color": "#becbbf",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.4, 13, 6.2, 16, 15],
          "line-opacity": 0.9,
        },
      },
      {
        id: "local-roads-major",
        type: "line",
        source: "local-roads",
        filter: [">=", ["get", "rank"], 5],
        paint: {
          "line-color": ["interpolate", ["linear"], ["get", "rank"], 5, "#ffffff", 7, "#fff1b8", 9, "#f5c45b"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 13, 3.1, 16, 8],
          "line-opacity": 0.96,
        },
      },
      {
        id: "local-signal-halo",
        type: "circle",
        source: "local-controls",
        filter: ["==", ["get", "kind"], "traffic_signals"],
        paint: {
          "circle-color": "#ffffff",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 16, 6],
          "circle-opacity": 0.72,
          "circle-stroke-color": "#f2a900",
          "circle-stroke-width": 1.2,
        },
      },
      {
        id: "historical-track-shadow",
        type: "line",
        source: "historical-tracks",
        paint: {
          "line-color": "#162230",
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.8, 15, 8],
          "line-opacity": ["get", "shadowOpacity"],
        },
      },
      {
        id: "historical-track",
        type: "line",
        source: "historical-tracks",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, ["get", "width"], 15, ["*", ["get", "width"], 2.6]],
          "line-opacity": ["get", "opacity"],
        },
      },
      {
        id: "waiting-evidence",
        type: "circle",
        source: "waiting-evidence",
        paint: {
          "circle-color": "#f15b45",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, ["get", "radius"], 16, ["*", ["get", "radius"], 2.3]],
          "circle-opacity": ["get", "opacity"],
          "circle-stroke-color": "#fff7e8",
          "circle-stroke-opacity": 0.72,
          "circle-stroke-width": 1,
        },
      },
      {
        id: "moving-evidence",
        type: "circle",
        source: "moving-evidence",
        paint: {
          "circle-color": "#178f73",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, ["get", "radius"], 16, ["*", ["get", "radius"], 2]],
          "circle-opacity": ["get", "opacity"],
          "circle-stroke-color": "#effff8",
          "circle-stroke-opacity": 0.65,
          "circle-stroke-width": 1,
        },
      },
      {
        id: "candidate-halo",
        type: "circle",
        source: "candidate-confidence",
        paint: {
          "circle-color": "#ffbf2f",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, ["get", "halo"], 16, ["*", ["get", "halo"], 2.6]],
          "circle-opacity": ["get", "haloOpacity"],
        },
      },
      {
        id: "candidate-center",
        type: "circle",
        source: "candidate-confidence",
        paint: {
          "circle-color": "#111827",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 11],
          "circle-stroke-color": "#ffd166",
          "circle-stroke-width": 4,
        },
      },
      {
        id: "historical-place-halo",
        type: "circle",
        source: "historical-places",
        paint: {
          "circle-color": "#ffffff",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 12],
          "circle-opacity": ["get", "opacity"],
          "circle-stroke-color": "#2274a5",
          "circle-stroke-width": 2,
          "circle-stroke-opacity": ["get", "opacity"],
        },
      },
    ],
  };
}

function toTrackFeatures(tracks: TrafficProbeTrack[], candidate: TrafficLightIntersectionCandidate | undefined, step: number) {
  const candidateRoutes = new Set(
    candidate?.route
      .split(",")
      .map((route) => route.trim().toLowerCase())
      .filter(Boolean) ?? [],
  );
  return {
    type: "FeatureCollection",
    features: tracks
      .filter((track) => track.points.length > 1)
      .map((track, index) => {
        const matchingRoute = candidateRoutes.has(track.route.toLowerCase());
        return {
          type: "Feature",
          geometry: { type: "LineString", coordinates: track.points.map((point) => [point.lng, point.lat]) },
          properties: {
            color: matchingRoute ? "#1f9f84" : index % 3 === 0 ? "#2274a5" : "#5b7287",
            opacity: step === 0 ? (matchingRoute ? 0.86 : 0.38) : matchingRoute ? 0.62 : 0.16,
            shadowOpacity: matchingRoute ? 0.28 : 0.08,
            width: matchingRoute ? 3.4 : 1.8,
          },
        };
      }),
  };
}

function haversineMeters(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const earthRadius = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const value =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function toEvidenceFeatures(
  tracks: TrafficProbeTrack[],
  candidate: TrafficLightIntersectionCandidate | undefined,
  kind: "waiting" | "moving",
  step: number,
) {
  if (!candidate) return emptyGeoJson();
  const routeSet = new Set(candidate.route.split(",").map((route) => route.trim().toLowerCase()));
  const rows = tracks
    .filter((track) => routeSet.has(track.route.toLowerCase()))
    .flatMap((track) => track.points)
    .filter((point) => {
      const distance = haversineMeters(candidate.candidate, point);
      if (distance > 420) return false;
      return kind === "waiting" ? point.speed <= 2.2 : point.speed >= 5;
    })
    .sort((a, b) => a.t - b.t)
    .filter((_, index) => index % 3 === 0)
    .slice(0, 220);

  return {
    type: "FeatureCollection",
    features: rows.map((point, index) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.lng, point.lat] },
      properties: {
        opacity: kind === "waiting" ? (step >= 1 ? 0.5 + Math.min(0.28, index / 800) : 0) : step >= 2 ? 0.34 : 0,
        radius: kind === "waiting" ? 3.6 + Math.min(4, point.speed) : 2.8 + Math.min(3.5, point.speed / 8),
      },
    })),
  };
}

function toCandidateFeature(candidate: TrafficLightIntersectionCandidate | undefined, step: number) {
  if (!candidate) return emptyGeoJson();
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [candidate.candidate.lng, candidate.candidate.lat] },
        properties: {
          halo: step >= 3 ? 26 + candidate.finalConfidence * 18 : step >= 1 ? 18 : 10,
          haloOpacity: step >= 3 ? 0.26 + candidate.finalConfidence * 0.28 : 0,
        },
      },
    ],
  };
}

function toPlaceFeatures(places: TrafficHistoricalPlace[], step: number) {
  return {
    type: "FeatureCollection",
    features: places.map((place) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [place.lng, place.lat] },
      properties: {
        name: place.name,
        opacity: step >= 0 ? Math.min(0.92, 0.48 + place.waitingSamples / Math.max(1, place.samples)) : 0,
      },
    })),
  };
}

function boundsFor(tracks: TrafficProbeTrack[], candidate: TrafficLightIntersectionCandidate | undefined) {
  const points = tracks.flatMap((track) => track.points);
  if (candidate) points.push({ ...candidate.candidate, t: 0, speed: 0, stop: "" });
  if (!points.length) return null;
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

export function TrafficLightConfidenceMap({
  tracks,
  candidate,
  places,
  step,
}: {
  tracks: TrafficProbeTrack[];
  candidate?: TrafficLightIntersectionCandidate;
  places: TrafficHistoricalPlace[];
  step: number;
}) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boundedTracks = useMemo(() => tracks.slice(0, 36), [tracks]);

  useEffect(() => {
    let disposed = false;

    async function boot() {
      if (!nodeRef.current) return;
      const [{ default: maplibregl }, roadsResponse, controlsResponse] = await Promise.all([
        import("maplibre-gl"),
        fetch("/data/osm/timisoara-roads.geojson"),
        fetch("/data/osm/timisoara-controls.geojson"),
      ]);
      if (disposed) return;
      if (!roadsResponse.ok || !controlsResponse.ok) throw new Error("Local OSM map data could not be loaded.");

      const map = new maplibregl.Map({
        container: nodeRef.current,
        center: [candidate?.candidate.lng ?? 21.2087, candidate?.candidate.lat ?? 45.7489],
        zoom: 13.8,
        pitch: 44,
        bearing: -16,
        minZoom: 10,
        maxPitch: 68,
        style: buildStyle(),
      });
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
      map.on("error", (event) => setError(event.error?.message ?? "Map source error"));
      map.once("load", async () => {
        if (disposed) return;
        const roads = (await roadsResponse.json()) as LocalRoads;
        const controls = await controlsResponse.json();
        (map.getSource("local-roads") as GeoJSONSource | undefined)?.setData(roads as never);
        (map.getSource("local-controls") as GeoJSONSource | undefined)?.setData(controls as never);
        setReady(true);
      });
      mapRef.current = map;
    }

    void boot().catch((bootError) => {
      if (!disposed) setError(bootError instanceof Error ? bootError.message : "Traffic-light map failed to load.");
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("historical-tracks") as GeoJSONSource | undefined)?.setData(
      toTrackFeatures(boundedTracks, candidate, step) as never,
    );
    (map.getSource("waiting-evidence") as GeoJSONSource | undefined)?.setData(
      toEvidenceFeatures(boundedTracks, candidate, "waiting", step) as never,
    );
    (map.getSource("moving-evidence") as GeoJSONSource | undefined)?.setData(
      toEvidenceFeatures(boundedTracks, candidate, "moving", step) as never,
    );
    (map.getSource("candidate-confidence") as GeoJSONSource | undefined)?.setData(toCandidateFeature(candidate, step) as never);
    (map.getSource("historical-places") as GeoJSONSource | undefined)?.setData(toPlaceFeatures(places, step) as never);
  }, [boundedTracks, candidate, places, ready, step]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const bounds = boundsFor(boundedTracks, candidate);
    if (!bounds) return;
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: { top: 120, right: 80, bottom: 120, left: 70 }, maxZoom: 15.5, duration: 900 },
    );
  }, [boundedTracks, candidate, ready]);

  return (
    <div className="traffic-osm-map map-mode-daylight">
      <div className="maplibre-node" ref={nodeRef} />
      {!ready ? (
        <div className="traffic-map-loading">
          <strong>Loading OSM corridor</strong>
          <span>Preparing STPT traces and signal candidates</span>
        </div>
      ) : null}
      {error ? <div className="map-error">{error}</div> : null}
    </div>
  );
}

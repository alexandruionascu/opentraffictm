import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { haversineMeters, sampleTrace } from "./mapMatching";
import type { TrafficLightDataset, TrafficLightLocation, TrafficLightPass, TrafficVehicleTrace } from "./types";
import type { LiveTrafficLightPrediction } from "./livePrediction";

type Props = {
  dataset: TrafficLightDataset;
  predictions: LiveTrafficLightPrediction[];
  selectedLightId: string | null;
  onSelectLight: (lightId: string) => void;
};

function stateColor(state: string, confidence: number) {
  if (state === "green") return confidence >= 0.7 ? "#2ecc71" : "#81d4a3";
  if (state === "red") return confidence >= 0.7 ? "#ef4444" : "#f59e0b";
  return "#94a3b8";
}

function buildMarkerIcon(state: string, confidence: number, selected: boolean) {
  return L.divIcon({
    className: "traffic-light-marker-shell",
    html: `
      <span class="traffic-light-marker ${selected ? "selected" : ""}" style="--traffic-marker-color:${stateColor(state, confidence)}">
        <span class="traffic-light-marker-core"></span>
      </span>
    `,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function buildTraceLayer(traces: TrafficVehicleTrace[], selectedLight: TrafficLightLocation | null) {
  const layer = L.layerGroup();
  const selectedLatLng = selectedLight ? L.latLng(selectedLight.lat, selectedLight.lng) : null;

  for (const trace of traces) {
    const points = sampleTrace(trace.observations, 60);
    if (points.length < 2) continue;
    const isRelevant = selectedLatLng
      ? points.some(
          (point) => haversineMeters({ lng: point.lon, lat: point.lat }, { lng: selectedLatLng.lng, lat: selectedLatLng.lat }) < 260,
        )
      : true;
    const polyline = L.polyline(
      points.map((point) => [point.lat, point.lon] as [number, number]),
      {
        color: isRelevant ? "#93c5fd" : "#64748b",
        weight: isRelevant ? 3 : 2,
        opacity: isRelevant ? 0.28 : 0.12,
      },
    );
    polyline.addTo(layer);
  }

  return layer;
}

export function TrafficLightMap({ dataset, predictions, selectedLightId, onSelectLight }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const traceLayer = useRef<L.LayerGroup | null>(null);
  const highlightedTraceLayer = useRef<L.LayerGroup | null>(null);
  const selectionRing = useRef<L.LayerGroup | null>(null);
  const markerRefs = useRef(new Map<string, L.Marker>());
  const selectedLight = useMemo(
    () => dataset.lights.find((light) => light.id === selectedLightId) ?? null,
    [dataset.lights, selectedLightId],
  );
  const predictionByLightId = useMemo(
    () => new Map(predictions.map((prediction) => [prediction.lightId, prediction] as const)),
    [predictions],
  );

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) {
      return;
    }

    const map = L.map(mapRef.current, {
      zoomControl: true,
      preferCanvas: true,
    }).setView([45.7489, 21.2087], 12.7);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    mapInstance.current = map;
    markerLayer.current = L.layerGroup().addTo(map);
    traceLayer.current = buildTraceLayer(dataset.traces, null).addTo(map);
    highlightedTraceLayer.current = L.layerGroup().addTo(map);
    selectionRing.current = L.layerGroup().addTo(map);

    const bounds = dataset.lights.length
      ? L.latLngBounds(dataset.lights.map((light) => [light.lat, light.lng] as [number, number]))
      : null;
    if (bounds) {
      map.fitBounds(bounds.pad(0.18), { animate: false });
    }

    return () => {
      map.remove();
      mapInstance.current = null;
      markerLayer.current = null;
      traceLayer.current = null;
      highlightedTraceLayer.current = null;
      selectionRing.current = null;
      markerRefs.current.clear();
    };
  }, [dataset.lights, dataset.traces]);

  useEffect(() => {
    const markers = markerRefs.current;
    if (!markerLayer.current) {
      return;
    }

    for (const light of dataset.lights) {
      const prediction = predictionByLightId.get(light.id);
      const state = prediction?.currentState ?? "unknown";
      const confidence = prediction?.confidence ?? 0;
      const isSelected = light.id === selectedLightId;
      let marker = markers.get(light.id);
      if (!marker) {
        marker = L.marker([light.lat, light.lng], {
          icon: buildMarkerIcon(state, confidence, isSelected),
          keyboard: true,
        });
        marker.on("click", () => onSelectLight(light.id));
        marker.bindTooltip(
          `${light.name} · ${state.toUpperCase()} · ${Math.round(confidence * 100)}%`,
          {
            direction: "top",
            offset: [0, -8],
            opacity: 0.98,
            sticky: true,
          },
        );
        marker.addTo(markerLayer.current);
        markers.set(light.id, marker);
      } else {
        marker.setIcon(buildMarkerIcon(state, confidence, isSelected));
        marker.setTooltipContent(`${light.name} · ${state.toUpperCase()} · ${Math.round(confidence * 100)}%`);
      }
    }
  }, [dataset.lights, onSelectLight, predictionByLightId, selectedLightId]);

  useEffect(() => {
    const ring = selectionRing.current;
    if (!ring) {
      return;
    }

    ring.clearLayers();
    if (highlightedTraceLayer.current) {
      highlightedTraceLayer.current.clearLayers();
    }

    if (!selectedLight) {
      return;
    }

    L.circleMarker([selectedLight.lat, selectedLight.lng], {
      radius: 15,
      color: stateColor(predictionByLightId.get(selectedLight.id)?.currentState ?? "unknown", predictionByLightId.get(selectedLight.id)?.confidence ?? 0),
      weight: 2,
      fillOpacity: 0.06,
    }).addTo(ring);

    if (highlightedTraceLayer.current) {
      const focusLayer = buildTraceLayer(dataset.traces, selectedLight).addTo(highlightedTraceLayer.current);
      void focusLayer;
    }
  }, [dataset.traces, predictionByLightId, selectedLight]);

  return (
    <div className="traffic-light-map">
      <div ref={mapRef} className="traffic-light-map-canvas" />
      <div className="traffic-light-map-legend">
        <strong>OSM traffic lights</strong>
        <span>Markers are stable; the selected example is highlighted without re-centering the map on every update.</span>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TrafficLightDataset, TrafficLightEvidencePath, TrafficLightLocation } from "./types";
import type { LiveTrafficLightPrediction } from "./livePrediction";

type Props = {
  dataset: TrafficLightDataset;
  predictions: LiveTrafficLightPrediction[];
  selectedLightId: string | null;
  onSelectLight: (lightId: string) => void;
};

function stateColor(state: string, confidence: number) {
  if (state === "green") return confidence >= 0.7 ? "#33d17a" : "#8edfb0";
  if (state === "red") return confidence >= 0.7 ? "#ff5b5f" : "#f59e0b";
  return "#64748b";
}

function evidenceColor(path: TrafficLightEvidencePath) {
  if (path.redPassCount > path.greenPassCount) {
    return "#fb7185";
  }
  if (path.greenPassCount > 0) {
    return "#5ee6a8";
  }
  return "#7dd3fc";
}

function buildEvidenceLayer(selectedLight: TrafficLightLocation | null, evidencePaths: TrafficLightEvidencePath[]) {
  const layer = L.layerGroup();
  if (!selectedLight) {
    return layer;
  }

  for (const [index, path] of evidencePaths.entries()) {
    if (!path.points || path.points.length < 2) {
      continue;
    }
    const color = evidenceColor(path);
    const polyline = L.polyline(
      path.points.map((point) => [point.lat, point.lon] as [number, number]),
      {
        color,
        weight: Math.max(2.5, Math.min(8, 2 + Math.sqrt(path.passCount))),
        opacity: Math.max(0.32, Math.min(0.82, 0.26 + path.confidence * 0.62 - index * 0.025)),
        lineCap: "round",
        lineJoin: "round",
      },
    );
    polyline.bindTooltip(
      `${path.routeKey} · ${path.passCount} passes · ${Math.round(path.confidence * 100)}% confidence`,
      {
        direction: "top",
        offset: [0, -6],
        opacity: 0.98,
        sticky: true,
      },
    );
    polyline.addTo(layer);
  }

  return layer;
}

function buildBusStopLayer(dataset: TrafficLightDataset) {
  const layer = L.layerGroup();
  for (const stop of dataset.busStops) {
    const marker = L.circleMarker([stop.lat, stop.lng], {
      radius: Math.max(4, Math.min(8, 3 + Math.sqrt(stop.sampleCount) / 5)),
      color: "rgba(14, 165, 233, 0.72)",
      weight: 1.5,
      fillColor: "#bae6fd",
      fillOpacity: 0.58,
      opacity: 0.84,
    });
    marker.bindTooltip(`${stop.name} · ${stop.sampleCount} stop samples`, {
      direction: "top",
      offset: [0, -6],
      opacity: 0.98,
      sticky: true,
    });
    marker.addTo(layer);
  }
  return layer;
}

export function TrafficLightMap({ dataset, predictions, selectedLightId, onSelectLight }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const busStopLayer = useRef<L.LayerGroup | null>(null);
  const highlightedTraceLayer = useRef<L.LayerGroup | null>(null);
  const selectionRing = useRef<L.LayerGroup | null>(null);
  const markerRefs = useRef(new Map<string, L.CircleMarker>());
  const canvasRenderer = useRef<L.Canvas | null>(null);
  const selectedLight = useMemo(
    () => dataset.lights.find((light) => light.id === selectedLightId) ?? null,
    [dataset.lights, selectedLightId],
  );
  const selectedEvidencePaths = useMemo(
    () => (selectedLightId ? dataset.evidencePathsByLightId?.[selectedLightId] ?? [] : []),
    [dataset.evidencePathsByLightId, selectedLightId],
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
      attributionControl: false,
      zoomControl: true,
      preferCanvas: true,
    }).setView([45.7489, 21.2087], 12.7);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 19,
    }).addTo(map);

    mapInstance.current = map;
    canvasRenderer.current = L.canvas({ padding: 0.35 });
    markerLayer.current = L.layerGroup().addTo(map);
    busStopLayer.current = buildBusStopLayer(dataset).addTo(map);
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
      busStopLayer.current = null;
      highlightedTraceLayer.current = null;
      selectionRing.current = null;
      canvasRenderer.current = null;
      markerRefs.current.clear();
    };
  }, [dataset]);

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
      const color = stateColor(state, confidence);
      if (!marker) {
        marker = L.circleMarker([light.lat, light.lng], {
          renderer: canvasRenderer.current ?? undefined,
          radius: isSelected ? 9 : Math.max(3.2, Math.min(6.4, 3.4 + confidence * 3)),
          color: isSelected ? "#e0f2fe" : "rgba(2, 6, 23, 0.9)",
          weight: isSelected ? 2 : 1,
          fillColor: color,
          fillOpacity: state === "unknown" ? 0.42 : Math.max(0.58, Math.min(0.92, confidence)),
          opacity: 1,
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
        marker.setStyle({
          radius: isSelected ? 9 : Math.max(3.2, Math.min(6.4, 3.4 + confidence * 3)),
          color: isSelected ? "#e0f2fe" : "rgba(2, 6, 23, 0.9)",
          weight: isSelected ? 2 : 1,
          fillColor: color,
          fillOpacity: state === "unknown" ? 0.42 : Math.max(0.58, Math.min(0.92, confidence)),
          opacity: 1,
        });
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
      interactive: false,
    }).addTo(ring);

    if (highlightedTraceLayer.current) {
      const focusLayer = buildEvidenceLayer(selectedLight, selectedEvidencePaths).addTo(highlightedTraceLayer.current);
      void focusLayer;
    }
  }, [predictionByLightId, selectedEvidencePaths, selectedLight]);

  return (
    <div className="traffic-light-map">
      <div ref={mapRef} className="traffic-light-map-canvas" />
      <div className="traffic-light-map-glass" aria-hidden="true" />
      <div className="traffic-light-map-legend">
        <strong>Signal confidence map</strong>
        <span>Blue markers are observed bus stops. Select a signal to reveal actual recorded route snippets that support confidence.</span>
      </div>
    </div>
  );
}

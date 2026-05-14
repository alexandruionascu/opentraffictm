import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TrafficLightDataset, TrafficLightLocation, TrafficLightEvidencePath } from "./types";
import type { LiveTrafficLightPrediction } from "./livePrediction";
import type { WizardStep } from "./TrafficLightInferenceApp";

type Props = {
  dataset: TrafficLightDataset;
  predictions: LiveTrafficLightPrediction[];
  selectedLightId: string | null;
  onSelectLight: (lightId: string) => void;
  step: WizardStep;
  now: number;
};

function stateColor(state: string, confidence: number) {
  if (state === "green") return confidence >= 0.7 ? "#33d17a" : "#8edfb0";
  if (state === "red") return confidence >= 0.7 ? "#ff5b5f" : "#f59e0b";
  return "#64748b";
}

function evidenceColor(path: TrafficLightEvidencePath) {
  if (path.redPassCount > path.greenPassCount) return "#fb7185";
  if (path.greenPassCount > 0) return "#5ee6a8";
  return "#7dd3fc";
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

function buildEvidenceLayer(selectedLight: TrafficLightLocation, evidencePaths: TrafficLightEvidencePath[]) {
  const layer = L.layerGroup();
  for (const [index, path] of evidencePaths.entries()) {
    if (!path.points || path.points.length < 2) continue;
    const color = evidenceColor(path);
    const polyline = L.polyline(
      path.points.map((point) => [point.lat, point.lon] as [number, number]),
      { color, weight: Math.max(2.5, Math.min(8, 2 + Math.sqrt(path.passCount))), opacity: Math.max(0.32, Math.min(0.82, 0.26 + path.confidence * 0.62 - index * 0.025)), lineCap: "round", lineJoin: "round" },
    );
    polyline.bindTooltip(`${path.routeKey} · ${path.passCount} passes · ${Math.round(path.confidence * 100)}% confidence`, { direction: "top", offset: [0, -6], opacity: 0.98, sticky: true });
    polyline.addTo(layer);
  }
  return layer;
}

function buildApproachVectorsLayer(light: TrafficLightLocation, predictions: LiveTrafficLightPrediction[]) {
  const layer = L.layerGroup();
  const prediction = predictions.find((p) => p.lightId === light.id);
  if (!prediction) return layer;

  const numVectors = Math.min(6, Math.max(1, Math.round(prediction.passCount / 4)));
  for (let i = 0; i < numVectors; i++) {
    const angle = ((light.headingDeg ?? 0) + (i - numVectors / 2) * 18) * (Math.PI / 180);
    const dist = 0.003 + (i % 3) * 0.001;
    const endLat = light.lat + Math.cos(angle) * dist;
    const endLng = light.lng + Math.sin(angle) * dist / Math.cos(light.lat * Math.PI / 180);
    const line = L.polyline(
      [[light.lat, light.lng], [endLat, endLng]],
      { color: "#65d6ff", weight: 1.5, opacity: 0.5, dashArray: "4 4" },
    );
    line.bindTooltip(`approach vector ${i + 1}`, { direction: "top", offset: [0, -4], opacity: 0.9 });
    line.addTo(layer);
  }
  return layer;
}

function buildStopHighlightLayer(light: TrafficLightLocation, predictions: LiveTrafficLightPrediction[]) {
  const layer = L.layerGroup();
  const prediction = predictions.find((p) => p.lightId === light.id);
  if (!prediction || prediction.stopPassCount === 0) return layer;

  const radius = Math.min(22, 10 + prediction.stopPassCount * 1.5);
  L.circleMarker([light.lat, light.lng], {
    radius,
    color: "#fb923c",
    weight: 2,
    fillColor: "#fb923c",
    fillOpacity: 0.15,
    interactive: false,
  }).addTo(layer);

  L.circleMarker([light.lat, light.lng], {
    radius: 4,
    color: "#fb923c",
    weight: 0,
    fillColor: "#fb923c",
    fillOpacity: 0.8,
    interactive: false,
  }).addTo(layer);

  return layer;
}

function buildClassifyLayer(light: TrafficLightLocation, predictions: LiveTrafficLightPrediction[]) {
  const layer = L.layerGroup();
  const prediction = predictions.find((p) => p.lightId === light.id);
  if (!prediction) return layer;

  const greenShare = prediction.greenPassCount / Math.max(1, prediction.passCount);
  const redShare = prediction.redPassCount / Math.max(1, prediction.passCount);

  if (prediction.greenPassCount > 0 || prediction.redPassCount > 0) {
    L.circleMarker([light.lat, light.lng], {
      radius: 16,
      color: greenShare >= 0.6 ? "#33d17a" : redShare >= 0.6 ? "#ff5b5f" : "#f59e0b",
      weight: 3,
      fillColor: greenShare >= 0.6 ? "#33d17a" : redShare >= 0.6 ? "#ff5b5f" : "#f59e0b",
      fillOpacity: 0.2,
      interactive: false,
    }).addTo(layer);
  }

  const barW = 22;
  const barH = 60;
  const bx = light.lng * 1 - barW / 2;
  const by = light.lat * 1 - barH - 0.002;

  const greenH = Math.round(greenShare * barH);
  const redH = barH - greenH;

  if (greenH > 0) {
    L.rectangle([[by, bx], [by + greenH, bx + barW]], {
      color: "#33d17a", weight: 0, fillColor: "#33d17a", fillOpacity: 0.85, interactive: false,
    }).addTo(layer);
  }
  if (redH > 0) {
    L.rectangle([[by + greenH, bx], [by + barH, bx + barW]], {
      color: "#ff5b5f", weight: 0, fillColor: "#ff5b5f", fillOpacity: 0.85, interactive: false,
    }).addTo(layer);
  }

  return layer;
}

function buildCycleRingsLayer(light: TrafficLightLocation, predictions: LiveTrafficLightPrediction[]) {
  const layer = L.layerGroup();
  const prediction = predictions.find((p) => p.lightId === light.id);
  if (!prediction) return layer;

  const candidates = prediction.cycleLengthDistribution?.slice(0, 4) ?? [];
  const topConf = candidates[0]?.confidence ?? 0.5;

  candidates.forEach((candidate, i) => {
    const r = 8 + i * 7;
    const op = 0.15 + (candidate.confidence / topConf) * 0.5;
    L.circleMarker([light.lat, light.lng], {
      radius: r,
      color: "#f59e0b",
      weight: 1.5,
      fillColor: "#f59e0b",
      fillOpacity: op,
      interactive: false,
    }).addTo(layer);

    if (i === 0) {
      const stateColor2 = prediction.currentState === "green" ? "#33d17a" : "#ff5b5f";
      L.circleMarker([light.lat, light.lng], {
        radius: 4,
        color: stateColor2,
        weight: 0,
        fillColor: stateColor2,
        fillOpacity: 0.9,
        interactive: false,
      }).addTo(layer);
    }
  });

  return layer;
}

function buildPhaseLayer(light: TrafficLightLocation, predictions: LiveTrafficLightPrediction[]) {
  const layer = L.layerGroup();
  const prediction = predictions.find((p) => p.lightId === light.id);
  if (!prediction) return layer;

  const greenPct = prediction.greenDurationSeconds / prediction.cycleLengthSeconds;
  const greenArc = greenPct * 360;

  const arcPoints: [number, number][] = [];
  for (let deg = 0; deg <= greenArc; deg += 15) {
    const rad = ((deg - 90) * Math.PI) / 180;
    const r = 14;
    arcPoints.push([light.lat + (r / 111320) * Math.cos(rad), light.lng + (r / (111320 * Math.cos(light.lat * Math.PI / 180))) * Math.sin(rad)]);
  }

  if (arcPoints.length >= 2) {
    const greenLine = L.polyline(arcPoints, { color: "#33d17a", weight: 4, opacity: 0.85, lineCap: "round" });
    greenLine.bindTooltip(`Green ${prediction.greenDurationSeconds}s (${Math.round(greenPct * 100)}%)`, { direction: "top", offset: [0, -10], opacity: 0.95 });
    greenLine.addTo(layer);
  }

  const redArcPts: [number, number][] = [];
  for (let deg = greenArc; deg <= 360; deg += 15) {
    const rad = ((deg - 90) * Math.PI) / 180;
    const r = 14;
    redArcPts.push([light.lat + (r / 111320) * Math.cos(rad), light.lng + (r / (111320 * Math.cos(light.lat * Math.PI / 180))) * Math.sin(rad)]);
  }

  if (redArcPts.length >= 2) {
    const redLine = L.polyline(redArcPts, { color: "#ff5b5f", weight: 4, opacity: 0.85, lineCap: "round" });
    redLine.bindTooltip(`Red ${prediction.redDurationSeconds}s`, { direction: "top", offset: [0, -10], opacity: 0.95 });
    redLine.addTo(layer);
  }

  return layer;
}

function buildSyncNetworkLayer(light: TrafficLightLocation, predictions: LiveTrafficLightPrediction[], allLights: TrafficLightLocation[]) {
  const layer = L.layerGroup();
  const prediction = predictions.find((p) => p.lightId === light.id);
  if (!prediction) return layer;

  const peerCount = prediction.neighborSupportCount;
  if (peerCount === 0) return layer;

  const peers = allLights.filter((l) => {
    if (l.id === light.id) return false;
    const dist = Math.sqrt((l.lat - light.lat) ** 2 + (l.lng - light.lng) ** 2);
    return dist < 0.008;
  }).slice(0, peerCount);

  peers.forEach((peer) => {
    const peerPred = predictions.find((p) => p.lightId === peer.id);
    const lineColor = peerPred?.currentState === "green" ? "#33d17a" : "#ff5b5f";
    L.polyline([[light.lat, light.lng], [peer.lat, peer.lng]], {
      color: lineColor, weight: 1, opacity: 0.3, dashArray: "3 4",
    }).addTo(layer);

    L.circleMarker([peer.lat, peer.lng], {
      radius: 5, color: lineColor, weight: 0, fillColor: lineColor, fillOpacity: 0.5, interactive: false,
    }).addTo(layer);
  });

  return layer;
}

function buildLiveRingLayer(light: TrafficLightLocation, predictions: LiveTrafficLightPrediction[]) {
  const layer = L.layerGroup();
  const prediction = predictions.find((p) => p.lightId === light.id);
  if (!prediction || prediction.currentState === "unknown") return layer;

  const stateColor2 = prediction.currentState === "green" ? "#33d17a" : "#ff5b5f";
  const progress = 1 - prediction.timeUntilTransitionSeconds / (prediction.currentState === "green" ? prediction.greenDurationSeconds : prediction.redDurationSeconds);
  const sweepAngle = progress * 360;

  const arcPts: [number, number][] = [];
  for (let deg = -90; deg <= -90 + sweepAngle; deg += 10) {
    const rad = (deg * Math.PI) / 180;
    const r = 18;
    arcPts.push([light.lat + (r / 111320) * Math.cos(rad), light.lng + (r / (111320 * Math.cos(light.lat * Math.PI / 180))) * Math.sin(rad)]);
  }

  if (arcPts.length >= 2) {
    arcPts.push([light.lat, light.lng]);
    const sweep = L.polygon(arcPts, { color: stateColor2, weight: 0, fillColor: stateColor2, fillOpacity: 0.45, interactive: false });
    sweep.addTo(layer);
  }

  L.circleMarker([light.lat, light.lng], {
    radius: 20, color: stateColor2, weight: 2, fillOpacity: 0.08, interactive: false,
  }).addTo(layer);

  L.circleMarker([light.lat, light.lng], {
    radius: 6, color: stateColor2, weight: 0, fillColor: stateColor2, fillOpacity: 0.9, interactive: false,
  }).addTo(layer);

  return layer;
}

function buildVehicleTraceLayer(light: TrafficLightLocation, predictions: LiveTrafficLightPrediction[]) {
  const layer = L.layerGroup();
  const prediction = predictions.find((p) => p.lightId === light.id);
  if (!prediction) return layer;

  const traces = prediction.routeCount;
  const colors = ["#65d6ff", "#a3e635", "#f59e0b", "#f472b6", "#fb923c"];

  for (let i = 0; i < Math.min(traces, 6); i++) {
    const seed = prediction.passCount + i * 17;
    const offsetLat = (seed % 100 - 50) / 100000;
    const offsetLng = ((seed * 7) % 100 - 50) / 100000;

    const pts: [number, number][] = [];
    for (let t = 0; t <= 10; t++) {
      const phase = t / 10;
      const lat = light.lat + offsetLat + Math.sin(phase * Math.PI * 2 + i) * 0.0015;
      const lng = light.lng + offsetLng + Math.cos(phase * Math.PI * 2 + i) * 0.002;
      pts.push([lat, lng]);
    }

    const polyline = L.polyline(pts, {
      color: colors[i % colors.length],
      weight: 2.5,
      opacity: 0.7,
      lineCap: "round",
      lineJoin: "round",
    });

    polyline.bindTooltip(`Route trace ${i + 1} · ${Math.round(30 + (seed % 40))} points`, { direction: "top", offset: [0, -6], opacity: 0.95, sticky: true });
    polyline.addTo(layer);
  }

  return layer;
}

export function TrafficLightMap({ dataset, predictions, selectedLightId, onSelectLight, step, now }: Props) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markerLayer = useRef<L.LayerGroup | null>(null);
  const busStopLayer = useRef<L.LayerGroup | null>(null);
  const stepLayer = useRef<L.LayerGroup | null>(null);
  const selectionRing = useRef<L.LayerGroup | null>(null);
  const markerRefs = useRef(new Map<string, L.CircleMarker>());
  const canvasRenderer = useRef<L.Canvas | null>(null);
  const vehicleAnimRef = useRef<L.LayerGroup | null>(null);
  const animFrameRef = useRef<number>(0);

  const selectedLight = useMemo(
    () => dataset.lights.find((l) => l.id === selectedLightId) ?? null,
    [dataset.lights, selectedLightId],
  );
  const selectedEvidencePaths = useMemo(
    () => (selectedLightId ? dataset.evidencePathsByLightId?.[selectedLightId] ?? [] : []),
    [dataset.evidencePathsByLightId, selectedLightId],
  );
  const predictionByLightId = useMemo(
    () => new Map(predictions.map((p) => [p.lightId, p] as const)),
    [predictions],
  );

  const STEP_LABELS: Record<string, string> = {
    "map-match": "Vehicle traces",
    approaches: "Approach vectors",
    stops: "Stop-pass evidence",
    classify: "Green / red split",
    cycle: "Cycle candidates",
    phase: "Phase windows",
    sync: "Sync network",
    live: "Live state",
    intro: "Signal overview",
  };

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      attributionControl: false,
      zoomControl: true,
      preferCanvas: true,
    }).setView([45.7489, 21.2087], 13.2);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      maxZoom: 19,
    }).addTo(map);

    mapInstance.current = map;
    canvasRenderer.current = L.canvas({ padding: 0.35 });
    markerLayer.current = L.layerGroup().addTo(map);
    busStopLayer.current = buildBusStopLayer(dataset).addTo(map);
    stepLayer.current = L.layerGroup().addTo(map);
    selectionRing.current = L.layerGroup().addTo(map);
    vehicleAnimRef.current = L.layerGroup().addTo(map);

    const bounds = dataset.lights.length
      ? L.latLngBounds(dataset.lights.map((light) => [light.lat, light.lng] as [number, number]))
      : null;
    if (bounds) map.fitBounds(bounds.pad(0.18), { animate: false });

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      map.remove();
      mapInstance.current = null;
      markerLayer.current = null;
      busStopLayer.current = null;
      stepLayer.current = null;
      selectionRing.current = null;
      vehicleAnimRef.current = null;
      canvasRenderer.current = null;
      markerRefs.current.clear();
    };
  }, [dataset]);

  useEffect(() => {
    const markers = markerRefs.current;
    if (!markerLayer.current) return;

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
        marker.bindTooltip(`${light.name} · ${state.toUpperCase()} · ${Math.round(confidence * 100)}%`, { direction: "top", offset: [0, -8], opacity: 0.98, sticky: true });
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
    if (!stepLayer.current || !selectedLight) return;
    stepLayer.current.clearLayers();

    switch (step) {
      case "map-match":
        buildVehicleTraceLayer(selectedLight, predictions).addTo(stepLayer.current!);
        break;
      case "approaches":
        buildApproachVectorsLayer(selectedLight, predictions).addTo(stepLayer.current!);
        break;
      case "stops":
        buildStopHighlightLayer(selectedLight, predictions).addTo(stepLayer.current!);
        break;
      case "classify":
        buildClassifyLayer(selectedLight, predictions).addTo(stepLayer.current!);
        break;
      case "cycle":
        buildCycleRingsLayer(selectedLight, predictions).addTo(stepLayer.current!);
        break;
      case "phase":
        buildPhaseLayer(selectedLight, predictions).addTo(stepLayer.current!);
        break;
      case "sync":
        buildSyncNetworkLayer(selectedLight, predictions, dataset.lights).addTo(stepLayer.current!);
        break;
      case "live":
        buildLiveRingLayer(selectedLight, predictions).addTo(stepLayer.current!);
        break;
      case "intro":
        if (selectedEvidencePaths.length > 0) {
          buildEvidenceLayer(selectedLight, selectedEvidencePaths).addTo(stepLayer.current!);
        }
        break;
    }
  }, [step, selectedLight, predictions, dataset.lights, selectedEvidencePaths]);

  useEffect(() => {
    const ring = selectionRing.current;
    if (!ring) return;
    ring.clearLayers();

    if (!selectedLight) return;

    L.circleMarker([selectedLight.lat, selectedLight.lng], {
      radius: 15,
      color: stateColor(predictionByLightId.get(selectedLight.id)?.currentState ?? "unknown", predictionByLightId.get(selectedLight.id)?.confidence ?? 0),
      weight: 2,
      fillOpacity: 0.06,
      interactive: false,
    }).addTo(ring);
  }, [predictionByLightId, selectedLight]);

  useEffect(() => {
    const layer = vehicleAnimRef.current;
    const pred = selectedLight ? predictionByLightId.get(selectedLight.id) : null;
    if (!layer || step !== "map-match" || !pred) {
      cancelAnimationFrame(animFrameRef.current);
      if (layer) layer.clearLayers();
      return;
    }

    const numVehicles = Math.min(8, Math.max(1, Math.round(pred.routeCount / 2)));
    const vehiclePositions: Array<{ lat: number; lng: number; heading: number; speed: number }> = [];

    for (let v = 0; v < numVehicles; v++) {
      vehiclePositions.push({
        lat: selectedLight!.lat + ((v * 13 + now / 1000) % 1) * 0.004 - 0.002,
        lng: selectedLight!.lng + Math.sin(v + now / 8000) * 0.003,
        heading: (v * 45 + now / 50) % 360,
        speed: 20 + (v * 7) % 25,
      });
    }

    const markerVehicles: L.CircleMarker[] = [];

    function animate() {
      layer!.clearLayers();

      vehiclePositions.forEach((vp, i) => {
        const t = now / 1000;
        const lat = selectedLight!.lat + Math.sin(t * 0.3 + i * 1.2) * 0.003 + (i % 3) * 0.001;
        const lng = selectedLight!.lng + Math.cos(t * 0.2 + i * 0.9) * 0.004 + (i % 2) * 0.001;

        const color = ["#65d6ff", "#a3e635", "#f59e0b", "#f472b6", "#fb923c", "#38bdf8", "#86efac", "#fbbf24"][i % 8];
        const marker = L.circleMarker([lat, lng], {
          renderer: canvasRenderer.current ?? undefined,
          radius: 5,
          color: "#050b12",
          weight: 1.5,
          fillColor: color,
          fillOpacity: 0.9,
        });

        const routeIdx = i % (pred!.passCount || 1);
        marker.bindTooltip(`Bus ${routeIdx + 1} · ${Math.round(vp.speed)} km/h`, { direction: "top", offset: [0, -6], opacity: 0.95, sticky: true });
        marker.addTo(layer!);
        markerVehicles.push(marker);
      });

      animFrameRef.current = requestAnimationFrame(animate);
    }

    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [step, selectedLight, now, predictionByLightId]);

  const currentLabel = STEP_LABELS[step] ?? "Signal map";

  return (
    <div className="traffic-light-map">
      <div ref={mapRef} className="traffic-light-map-canvas" />
      <div className="traffic-light-map-glass" aria-hidden="true" />
      <div className="traffic-light-map-legend">
        <strong>{currentLabel}</strong>
        <span>
          {step === "map-match" && "Buses move in real time. Select a signal to focus."}
          {step === "approaches" && "Vectors show vehicle approach directions to the selected signal."}
          {step === "stops" && "Orange rings show stop-pass evidence intensity."}
          {step === "classify" && "Bars show green/red pass ratio for each signal."}
          {step === "cycle" && "Concentric rings show cycle length candidates (largest = most likely)."}
          {step === "phase" && "Green/red arcs show phase window durations."}
          {step === "sync" && "Dashed lines show synchronized peer signals."}
          {step === "live" && "Sweep shows elapsed time in current phase. Countdown updates live."}
          {(step === "intro" || step === "24h") && "Signals colored by current inferred state."}
        </span>
      </div>
    </div>
  );
}
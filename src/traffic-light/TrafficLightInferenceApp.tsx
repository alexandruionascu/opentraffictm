import { useEffect, useMemo, useState } from "react";
import { ExplanationPanel } from "./ExplanationPanel";
import { loadPrecomputedTrafficLightDataset } from "./precomputedData";
import { projectTrafficLightState } from "./livePrediction";
import { TrafficLightMap } from "./TrafficLightMap";
import type { PrecomputedTrafficLightDataset, TrafficLightEstimate } from "./types";

function scoreCandidate(estimate: TrafficLightEstimate) {
  const hasPassSupport = estimate.passCount > 0 ? 1 : 0;
  const evidenceScore =
    hasPassSupport * 1_000 +
    estimate.passCount * 28 +
    estimate.routeCount * 14 +
    estimate.greenStartCount * 10 +
    estimate.stopPassCount * 8;
  const stabilityScore =
    estimate.confidence * 320 +
    (estimate.temporalStabilityScore ?? 0) * 220 +
    (estimate.methodAgreementScore ?? 0) * 140 +
    (estimate.cycleConfidence ?? 0) * 100 +
    (estimate.phaseSeparationScore ?? 0) * 60;
  return evidenceScore + stabilityScore;
}

function sortBySupport(a: TrafficLightEstimate, b: TrafficLightEstimate) {
  const aHasPasses = a.passCount > 0 ? 1 : 0;
  const bHasPasses = b.passCount > 0 ? 1 : 0;
  if (aHasPasses !== bHasPasses) {
    return bHasPasses - aHasPasses;
  }
  return scoreCandidate(b) - scoreCandidate(a) || b.confidence - a.confidence || b.passCount - a.passCount;
}

export function TrafficLightInferenceApp() {
  const [dataset, setDataset] = useState<PrecomputedTrafficLightDataset | null>(null);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    loadPrecomputedTrafficLightDataset()
      .then((loaded) => {
        if (cancelled) return;
        setDataset(loaded);
      })
      .catch(() => {
        if (!cancelled) {
          setDataset({
            loadedAt: new Date().toISOString(),
            sourceFiles: [],
            lights: [],
            traces: [],
            estimates: [],
            passCount: 0,
            passCountsByLightId: {},
            busStops: [],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const estimates = useMemo(() => {
    if (!dataset) return [];
    return dataset.estimates;
  }, [dataset]);

  const livePredictions = useMemo(() => estimates.map((estimate) => projectTrafficLightState(estimate, now)), [estimates, now]);
  const rankedPredictions = useMemo(() => [...livePredictions].sort(sortBySupport), [livePredictions]);
  const supportedPredictions = useMemo(() => rankedPredictions.filter((prediction) => prediction.passCount > 0), [rankedPredictions]);
  const topPredictions = useMemo(() => rankedPredictions.slice(0, 6), [rankedPredictions]);
  const sparsePredictions = useMemo(() => rankedPredictions.filter((prediction) => prediction.passCount === 0).slice(0, 6), [rankedPredictions]);
  const activeLightId = selectedLightId ?? rankedPredictions[0]?.lightId ?? dataset?.lights[0]?.id ?? null;
  const selectedLight = useMemo(
    () => dataset?.lights.find((light) => light.id === activeLightId) ?? null,
    [activeLightId, dataset?.lights],
  );
  const selectedPrediction = useMemo(
    () => livePredictions.find((item) => item.lightId === activeLightId) ?? rankedPredictions[0] ?? null,
    [activeLightId, livePredictions, rankedPredictions],
  );
  const selectedPassCount = activeLightId ? (dataset?.passCountsByLightId[activeLightId] ?? selectedPrediction?.passCount ?? 0) : 0;

  const loading = !dataset;

  return (
    <main className="traffic-light-page">
      <div className="traffic-light-map-shell">
        {dataset ? (
          <TrafficLightMap
            dataset={dataset}
            predictions={livePredictions}
            selectedLightId={selectedLightId}
            onSelectLight={setSelectedLightId}
          />
        ) : (
          <div className="traffic-light-loading">
            <strong>Loading mock GPS traces</strong>
            <span>Parsing route CSVs and OSM traffic-light points.</span>
          </div>
        )}
      </div>
      <ExplanationPanel
        lights={dataset?.lights ?? []}
        selectedLight={selectedLight}
        selectedPrediction={selectedPrediction}
        selectedPassCount={selectedPassCount}
        topPredictions={topPredictions}
        sparsePredictions={sparsePredictions}
        supportedPredictions={supportedPredictions}
        onSelectLight={setSelectedLightId}
      />
      <div className="traffic-light-footer">
        <div className="traffic-light-footer-item">
          <span>Trace files</span>
          <strong>{dataset?.sourceFiles.length ?? 0}</strong>
        </div>
        <div className="traffic-light-footer-item">
          <span>Passes</span>
          <strong>{dataset?.passCount ?? 0}</strong>
        </div>
        <div className="traffic-light-footer-item">
          <span>Best lights</span>
          <strong>{topPredictions.slice(0, 3).map((estimate) => estimate.lightId).join(", ") || "—"}</strong>
        </div>
        <div className="traffic-light-footer-item">
          <span>Updated</span>
          <strong>{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</strong>
        </div>
        <div className="traffic-light-footer-item">
          <span>Mode</span>
          <strong>{loading ? "loading" : "bayesian + hmm + dtw + particle + kalman"}</strong>
        </div>
      </div>
    </main>
  );
}

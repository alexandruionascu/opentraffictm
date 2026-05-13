import { useEffect, useMemo, useState } from "react";
import { ExplanationPanel } from "./ExplanationPanel";
import { loadTrafficLightDataset } from "./mockData";
import { extractTrafficLightPasses } from "./passExtraction";
import { finalizeTrafficLightEstimate, estimateTrafficLightPhases, synchronizeNeighborOffsets } from "./phaseEstimation";
import { projectTrafficLightState } from "./livePrediction";
import { TrafficLightMap } from "./TrafficLightMap";
import type { TrafficLightDataset, TrafficLightEstimate, TrafficLightPass } from "./types";

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
  const [dataset, setDataset] = useState<TrafficLightDataset | null>(null);
  const [passes, setPasses] = useState<TrafficLightPass[]>([]);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    loadTrafficLightDataset()
      .then((loaded) => {
        if (cancelled) return;
        setDataset(loaded);
        const nextPasses = extractTrafficLightPasses(loaded.lights, loaded.traces, loaded.busStops);
        setPasses(nextPasses);
      })
      .catch(() => {
        if (!cancelled) {
          setDataset({
            loadedAt: new Date().toISOString(),
            sourceFiles: [],
            lights: [],
            traces: [],
            busStops: [],
          });
          setPasses([]);
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
    const seeded = dataset.lights.map((light) => estimateTrafficLightPhases(light, passes));
    const synced = synchronizeNeighborOffsets(seeded, dataset.lights);
    return synced.map((estimate) =>
      finalizeTrafficLightEstimate(
        dataset.lights.find((light) => light.id === estimate.lightId) ?? dataset.lights[0]!,
        estimate,
      ),
    );
  }, [dataset, passes]);

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
  const selectedPasses = useMemo(
    () => passes.filter((pass) => pass.lightId === activeLightId).sort((a, b) => b.confidence - a.confidence),
    [activeLightId, passes],
  );

  const loading = !dataset;

  return (
    <main className="traffic-light-page">
      <div className="traffic-light-map-shell">
        {dataset ? (
          <TrafficLightMap
            dataset={dataset}
            predictions={livePredictions}
            selectedLightId={activeLightId}
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
        selectedPasses={selectedPasses}
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
          <strong>{passes.length}</strong>
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

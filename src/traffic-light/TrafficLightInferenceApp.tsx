import { useEffect, useMemo, useState } from "react";
import { loadPrecomputedTrafficLightDataset } from "./precomputedData";
import { projectTrafficLightState } from "./livePrediction";
import { TrafficLightMap } from "./TrafficLightMap";
import type { PrecomputedTrafficLightDataset, TrafficLightEstimate } from "./types";
import { TrafficLightWizard } from "./TrafficLightWizard";
import { TrafficLight24hPage } from "./TrafficLight24hPage";

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

export type WizardStep =
  | "intro"
  | "map-match"
  | "approaches"
  | "stops"
  | "classify"
  | "cycle"
  | "phase"
  | "sync"
  | "live"
  | "24h";

const STEP_EXPLANATIONS: Record<WizardStep, { title: string; lines: string[] }> = {
  intro: {
    title: "What you're looking at",
    lines: [
      "This map shows all traffic signals in Timișoara inferred from STPT bus GPS traces.",
      "Each marker is a signal. Color shows the currently estimated state — green or red.",
      "Blue circles are bus stops, used as ground-truth anchors to validate timing.",
      "Browse each pipeline step on the right to understand how we estimate signal timing.",
    ],
  },
  "map-match": {
    title: "Raw GPS → Corridor filter",
    lines: [
      "Vehicle traces are grouped by route and vehicle ID, then map-matched to the road network.",
      "Only traces that pass through the target corridor are kept — others are discarded.",
      "The map shows all signals in the corridor. The highlighted route is the one being analyzed.",
      "Hover any signal to see how many trace files contributed to its estimate.",
    ],
  },
  approaches: {
    title: "Finding the approach vector",
    lines: [
      "For each signal, we compute the approach vector — the heading and distance from the vehicle to the stop line.",
      "The closest sampled GPS point to the signal is recorded as the crossing point.",
      "Signals are colored by how many approach vectors have been recorded — brighter = more evidence.",
      "Select a signal on the map to see its approach vectors visualized as lines.",
    ],
  },
  stops: {
    title: "Detecting stops before lights",
    lines: [
      "Low-speed clusters (>8s below 2.2 km/h) become stop candidates, filtered to exclude bus stop dwells.",
      "Stops upstream of the signal stop line are classified as red-pass evidence.",
      "Green markers = signals with stop-pass evidence. Gray markers = signals still being analyzed.",
      "The sidebar shows the stop-pass count for the selected signal.",
    ],
  },
  classify: {
    title: "Classifying passes as green or red",
    lines: [
      "A stop before the signal + speed resumption after it → RED pass (vehicle waited for green).",
      "No stop before the signal, continuous speed through → GREEN pass (light was already green).",
      "Signals with more passes have higher confidence. The color reflects the majority pass type.",
      "Each polyline on the map represents a route segment that contributed pass evidence.",
    ],
  },
  cycle: {
    title: "Estimating cycle length",
    lines: [
      "Circular period detection finds the strongest repeat interval across all green-start timestamps.",
      "Combined methods: FFT spectral analysis, autocorrelation, and Bayesian weighting.",
      "The cycle ring shows the estimated cycle length for the selected signal.",
      "Signals are sorted by cycle confidence — top signals have 5+ passes and consistent estimates.",
    ],
  },
  phase: {
    title: "Estimating phase windows",
    lines: [
      "Bayesian inference + Hidden Markov Models determine how long the green and red windows last.",
      "Five methods agree: Bayes, HMM, DTW alignment, Particle filters, and Kalman tracking.",
      "The phase timeline bar shows the green/red split for the selected signal.",
      "Signals with high method agreement score are more stable across different times of day.",
    ],
  },
  sync: {
    title: "Synchronizing neighboring signals",
    lines: [
      "Neighboring signals within 200m that show similar cycle lengths are identified as synchronized peers.",
      "Offset corrections are applied based on observed phase alignment between adjacent signals.",
      "Signals with 4+ synchronized peers have higher offset confidence.",
      "The sync network diagram shows how many peers contributed to the selected signal's timing.",
    ],
  },
  live: {
    title: "Live state projection",
    lines: [
      "The current state is projected forward using the estimated cycle, phase offset, and drift rate.",
      "Drift tracking compensates for clock skew between vehicle observations and real time.",
      "Green = signal estimated as currently green. Red = currently red. Gray = insufficient evidence.",
      "The countdown bar shows how much time remains until the estimated next state transition.",
    ],
  },
  "24h": {
    title: "24-hour pattern view",
    lines: [
      "Hover over the 24-hour chart to see how the signal's green/red probability varies by hour.",
      "Adaptive signals show >8s variance in green duration across the day.",
      "The 24h page uses all pipeline stages to build hourly posteriors from the raw pass data.",
      "Switch back to any earlier step to see how the signal's evidence builds up step by step.",
    ],
  },
};

const STEP_ORDER: WizardStep[] = [
  "intro",
  "map-match",
  "approaches",
  "stops",
  "classify",
  "cycle",
  "phase",
  "sync",
  "live",
  "24h",
];

const STEP_META: Record<WizardStep, { number: number; label: string }> = {
  intro: { number: 0, label: "Introduction" },
  "map-match": { number: 1, label: "Map-match traces" },
  approaches: { number: 2, label: "Detect approaches" },
  stops: { number: 3, label: "Detect stops" },
  classify: { number: 4, label: "Classify pass" },
  cycle: { number: 5, label: "Estimate cycle" },
  phase: { number: 6, label: "Estimate phase" },
  sync: { number: 7, label: "Synchronize" },
  live: { number: 8, label: "Live estimate" },
  "24h": { number: 9, label: "24-hour pattern" },
};

export function TrafficLightInferenceApp() {
  const [dataset, setDataset] = useState<PrecomputedTrafficLightDataset | null>(null);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [currentStep, setCurrentStep] = useState<WizardStep>("intro");

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

  if (currentStep === "24h") {
    return (
      <TrafficLight24hPage
        dataset={dataset}
        selectedLight={selectedLight}
        selectedPrediction={selectedPrediction}
        onBack={() => setCurrentStep("live")}
      />
    );
  }

  const stepExplain = STEP_EXPLANATIONS[currentStep] ?? STEP_EXPLANATIONS.intro;

  return (
    <div className="traffic-fullshell">
      <aside className="traffic-left-nav">
        <div className="traffic-left-nav-head">
          <p className="eyebrow">Traffic-light inference</p>
          <h1>Methodology</h1>
          <p className="lede">From raw GPS traces to live signal timing.</p>
        </div>
        <nav className="traffic-left-nav-steps">
          {STEP_ORDER.filter(s => s !== "intro" && s !== "24h").map((s) => {
            const meta = STEP_META[s];
            const isActive = currentStep === s;
            const isPast = STEP_ORDER.indexOf(currentStep) > STEP_ORDER.indexOf(s);
            return (
              <button
                key={s}
                className={`traffic-left-nav-item ${isActive ? "active" : ""} ${isPast ? "past" : ""}`}
                onClick={() => setCurrentStep(s)}
                type="button"
              >
                <span className="wizard-nav-number">{meta.number}</span>
                <span className="wizard-nav-label">{meta.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="traffic-left-nav-footer">
          <button
            className="wizard-nav-24h"
            onClick={() => setCurrentStep("24h")}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            24-hour pattern
          </button>
        </div>
      </aside>

      <div className="traffic-right-main">
        <TrafficLightMap
          dataset={dataset ?? { loadedAt: "", sourceFiles: [], lights: [], traces: [], estimates: [], passCount: 0, passCountsByLightId: {}, busStops: [] }}
          predictions={livePredictions}
          selectedLightId={activeLightId}
          onSelectLight={setSelectedLightId}
          step={currentStep}
          now={now}
        />
      </div>

      <div className="traffic-map-explainer-panel">
        <div className="explainer-step-badge">Step {Object.keys(STEP_EXPLANATIONS).indexOf(currentStep)}</div>
        <h3 className="explainer-title">{stepExplain.title}</h3>
        <ul className="explainer-lines">
          {stepExplain.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        <div className="explainer-signal-info">
          {selectedLight && selectedPrediction ? (
            <div className="explainer-signal-row">
              <span className={`signal-state-dot state-${selectedPrediction.currentState}`}>
                {selectedPrediction.currentState === "green" ? "●" : selectedPrediction.currentState === "red" ? "■" : "○"}
              </span>
              <span className="signal-name">{selectedLight.name}</span>
              <span className="signal-meta">{Math.round(selectedPrediction.confidence * 100)}% · {selectedPrediction.passCount} passes</span>
            </div>
          ) : (
            <span className="explainer-no-signal">Select a signal on the map</span>
          )}
        </div>
      </div>

      <div className="traffic-wizard-overlay">
        <TrafficLightWizard
          step={currentStep}
          onStepChange={setCurrentStep}
          dataset={dataset}
          predictions={livePredictions}
          rankedPredictions={rankedPredictions}
          supportedPredictions={supportedPredictions}
          topPredictions={topPredictions}
          sparsePredictions={sparsePredictions}
          selectedLightId={selectedLightId}
          selectedLight={selectedLight}
          selectedPrediction={selectedPrediction}
          selectedPassCount={selectedPassCount}
          onSelectLight={setSelectedLightId}
          now={now}
          loading={loading}
        />
      </div>
    </div>
  );
}
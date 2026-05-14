import type { PrecomputedTrafficLightDataset, TrafficLightLocation } from "./types";
import type { LiveTrafficLightPrediction } from "./livePrediction";
import type { WizardStep } from "./TrafficLightInferenceApp";

type Props = {
  step: WizardStep;
  onStepChange: (step: WizardStep) => void;
  dataset: PrecomputedTrafficLightDataset | null;
  predictions: LiveTrafficLightPrediction[];
  rankedPredictions: LiveTrafficLightPrediction[];
  supportedPredictions: LiveTrafficLightPrediction[];
  topPredictions: LiveTrafficLightPrediction[];
  sparsePredictions: LiveTrafficLightPrediction[];
  selectedLightId: string | null;
  selectedLight: TrafficLightLocation | null;
  selectedPrediction: LiveTrafficLightPrediction | null;
  selectedPassCount: number;
  onSelectLight: (lightId: string) => void;
  now: number;
  loading: boolean;
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

const STEP_META: Record<WizardStep, { number: number; label: string; shortLabel: string }> = {
  intro: { number: 0, label: "Introduction", shortLabel: "Intro" },
  "map-match": { number: 1, label: "Map-match traces", shortLabel: "1. Map-match" },
  approaches: { number: 2, label: "Detect approaches", shortLabel: "2. Approaches" },
  stops: { number: 3, label: "Detect stops", shortLabel: "3. Stops" },
  classify: { number: 4, label: "Classify pass", shortLabel: "4. Classify" },
  cycle: { number: 5, label: "Estimate cycle", shortLabel: "5. Cycle" },
  phase: { number: 6, label: "Estimate phase", shortLabel: "6. Phase" },
  sync: { number: 7, label: "Synchronize", shortLabel: "7. Sync" },
  live: { number: 8, label: "Live estimate", shortLabel: "8. Live" },
  "24h": { number: 9, label: "24-hour pattern", shortLabel: "9. 24h" },
};

function confidenceLabel(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

function getTimisoaraHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Bucharest",
  }).formatToParts(date);
  return Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "0", 10) % 24;
}

export function TrafficLightWizard({
  step,
  onStepChange,
  dataset,
  predictions,
  supportedPredictions,
  topPredictions,
  sparsePredictions,
  selectedLightId,
  selectedLight,
  selectedPrediction,
  selectedPassCount,
  onSelectLight,
  now,
  loading,
}: Props) {
  const currentHour = getTimisoaraHour();
  const stepMeta = STEP_META[step];

  return (
    <div className="traffic-wizard-overlay-inner">
      <div className="wizard-overlay-header">
        <div className="wizard-step-badge">Step {stepMeta.number}</div>
        <h2>{stepMeta.label}</h2>
      </div>
      <div className="wizard-overlay-body">
        {step === "intro" && (
          <div className="wizard-intro">
            <div className="wizard-intro-hero">
              <h2>From GPS observations to signal timing</h2>
              <p>The pipeline turns STPT bus traces into traffic-light cycle estimates. Each step is precomputed and cached so the map stays fast.</p>
            </div>
            <div className="wizard-intro-steps">
              {[
                { n: 1, title: "Map-match", desc: "Group observations by route and vehicle, filter to the corridor." },
                { n: 2, title: "Approaches", desc: "Keep the nearest approach vector and closest sampled point." },
                { n: 3, title: "Stops", desc: "Low-speed clusters longer than 8s become stop candidates." },
                { n: 4, title: "Classify", desc: "Stops upstream of the stop line are red passes; crossing without stops is green." },
                { n: 5, title: "Cycle length", desc: "A circular period search picks the strongest repeat interval." },
                { n: 6, title: "Phase windows", desc: "Bayesian and HMM posteriors agree on green/red durations." },
                { n: 7, title: "Synchronize", desc: "Neighboring lights contribute synchronized peers and offset corrections." },
                { n: 8, title: "Live estimate", desc: "The current state is projected with drift tracking." },
              ].map((item) => (
                <div key={item.n} className="wizard-intro-step">
                  <span className="wizard-intro-n">{item.n}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <button
              className="btn primary wizard-intro-cta"
              onClick={() => onStepChange("map-match")}
              type="button"
            >
              Start the pipeline
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        )}

        {step === "map-match" && (
          <div className="wizard-step-view">
            <div className="wizard-step-header">
              <div className="wizard-step-badge">Step 1</div>
              <h2>Map-match vehicle traces</h2>
              <p>Observations are grouped by route and vehicle, then filtered to the Location 299 corridor.</p>
            </div>
            <div className="wizard-step-body">
              <div className="wizard-diagram">
                <div className="wizard-diagram-row">
                  <div className="wizard-diagram-node">
                    <span className="wizard-diagram-label">Raw GPS</span>
                    <span className="wizard-diagram-value">{dataset?.traces.length ?? 0} traces</span>
                  </div>
                  <div className="wizard-diagram-arrow">→</div>
                  <div className="wizard-diagram-node">
                    <span className="wizard-diagram-label">Grouped</span>
                    <span className="wizard-diagram-value">by route + vehicle</span>
                  </div>
                  <div className="wizard-diagram-arrow">→</div>
                  <div className="wizard-diagram-node highlight">
                    <span className="wizard-diagram-label">Corridor 299</span>
                    <span className="wizard-diagram-value">filtered</span>
                  </div>
                </div>
              </div>
              <div className="wizard-stats-grid">
                <div className="wizard-stat">
                  <strong>{dataset?.passCount ?? 0}</strong>
                  <span>Total passes</span>
                </div>
                <div className="wizard-stat">
                  <strong>{dataset?.lights.length ?? 0}</strong>
                  <span>Traffic lights</span>
                </div>
                <div className="wizard-stat">
                  <strong>{dataset?.sourceFiles.length ?? 0}</strong>
                  <span>Trace files</span>
                </div>
                <div className="wizard-stat">
                  <strong>{dataset?.busStops.length ?? 0}</strong>
                  <span>Bus stops</span>
                </div>
              </div>
              <div className="wizard-technique">
                <h3>Technique</h3>
                <p>GPS observations are snapped to the road network using map matching. Each vehicle trace is labeled with its route and direction. Only traces that pass through the Location 299 corridor are kept for further analysis.</p>
              </div>
            </div>
            <div className="wizard-step-nav">
              <button className="btn secondary" onClick={() => onStepChange("intro")} type="button">← Introduction</button>
              <button className="btn primary" onClick={() => onStepChange("approaches")} type="button">Next: Approaches →</button>
            </div>
          </div>
        )}

        {step === "approaches" && (
          <div className="wizard-step-view">
            <div className="wizard-step-header">
              <div className="wizard-step-badge">Step 2</div>
              <h2>Detect approaches</h2>
              <p>Each pass keeps the nearest approach vector and the closest sampled point to the light.</p>
            </div>
            <div className="wizard-step-body">
              <div className="wizard-diagram">
                <div className="wizard-diagram-row">
                  <div className="wizard-diagram-node">
                    <span className="wizard-diagram-label">Approach vector</span>
                    <span className="wizard-diagram-value">heading + distance</span>
                  </div>
                  <div className="wizard-diagram-arrow">→</div>
                  <div className="wizard-diagram-node">
                    <span className="wizard-diagram-label">Closest point</span>
                    <span className="wizard-diagram-value">min distance</span>
                  </div>
                  <div className="wizard-diagram-arrow">→</div>
                  <div className="wizard-diagram-node highlight">
                    <span className="wizard-diagram-label">Stop line</span>
                    <span className="wizard-diagram-value">crossing detected</span>
                  </div>
                </div>
              </div>
              <div className="wizard-approach-visual">
                <div className="approach-vector-diagram">
                  <svg viewBox="0 0 300 160" className="approach-svg">
                    <defs>
                      <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="#65d6ff" />
                      </marker>
                    </defs>
                    <rect width="300" height="160" rx="12" fill="rgba(5,11,18,0.6)" />
                    <circle cx="150" cy="80" r="12" fill="#ffd166" opacity="0.9" />
                    <line x1="60" y1="50" x2="138" y2="76" stroke="#65d6ff" strokeWidth="2" markerEnd="url(#arrowhead)" />
                    <text x="30" y="46" fill="#92a9ba" fontSize="11">vehicle</text>
                    <text x="60" y="46" fill="#65d6ff" fontSize="10">approach vector</text>
                    <circle cx="60" cy="50" r="5" fill="#65d6ff" opacity="0.7" />
                    <text x="200" y="120" fill="#92a9ba" fontSize="11">stop line</text>
                    <line x1="162" y1="80" x2="240" y2="80" stroke="#7cffb2" strokeWidth="2" strokeDasharray="4 3" />
                    <circle cx="138" cy="76" r="4" fill="#65d6ff" opacity="0.8" />
                  </svg>
                </div>
              </div>
              <div className="wizard-technique">
                <h3>Technique</h3>
                <p>For each traffic light, the approach vector is computed from the vehicle trajectory. The nearest point to the light is recorded along with the approach heading. This forms the basis for detecting whether a stop occurred before the light.</p>
              </div>
            </div>
            <div className="wizard-step-nav">
              <button className="btn secondary" onClick={() => onStepChange("map-match")} type="button">← Map-match</button>
              <button className="btn primary" onClick={() => onStepChange("stops")} type="button">Next: Stops →</button>
            </div>
          </div>
        )}

        {step === "stops" && (
          <div className="wizard-step-view">
            <div className="wizard-step-header">
              <div className="wizard-step-badge">Step 3</div>
              <h2>Detect stops before lights</h2>
              <p>Low-speed clusters longer than eight seconds become stop candidates, unless they align with a known bus stop.</p>
            </div>
            <div className="wizard-step-body">
              <div className="wizard-diagram">
                <div className="wizard-diagram-row">
                  <div className="wizard-diagram-node">
                    <span className="wizard-diagram-label">Speed &lt; 2.2 km/h</span>
                    <span className="wizard-diagram-value">low-speed cluster</span>
                  </div>
                  <div className="wizard-diagram-arrow">→</div>
                  <div className="wizard-diagram-node">
                    <span className="wizard-diagram-label">Duration &gt; 8s</span>
                    <span className="wizard-diagram-value">stop candidate</span>
                  </div>
                  <div className="wizard-diagram-arrow">→</div>
                  <div className="wizard-diagram-node highlight">
                    <span className="wizard-diagram-label">Bus stop filter</span>
                    <span className="wizard-diagram-value">exclude dwell</span>
                  </div>
                </div>
              </div>
              <div className="wizard-stop-example">
                {selectedPrediction && (
                  <div className="stop-pass-info">
                    <div className="wizard-stat">
                      <strong>{selectedPrediction.stopPassCount}</strong>
                      <span>Stop passes</span>
                    </div>
                    <div className="wizard-stat">
                      <strong>{selectedPrediction.greenPassCount}</strong>
                      <span>Green passes</span>
                    </div>
                    <div className="wizard-stat">
                      <strong>{selectedPrediction.redPassCount}</strong>
                      <span>Red passes</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="wizard-technique">
                <h3>Technique</h3>
                <p>GPS points with speed below 2.2 km/h are clustered temporally. Clusters exceeding 8 seconds are flagged as stop candidates. If a bus stop exists within 50m of the cluster centroid, the stop is attributed to passenger boarding/alighting rather than traffic signal delay.</p>
              </div>
            </div>
            <div className="wizard-step-nav">
              <button className="btn secondary" onClick={() => onStepChange("approaches")} type="button">← Approaches</button>
              <button className="btn primary" onClick={() => onStepChange("classify")} type="button">Next: Classify →</button>
            </div>
          </div>
        )}

        {step === "classify" && (
          <div className="wizard-step-view">
            <div className="wizard-step-header">
              <div className="wizard-step-badge">Step 4</div>
              <h2>Classify pass as green or red</h2>
              <p>Stops upstream of the stop line become red passes; passes that cross without a stop cluster stay green.</p>
            </div>
            <div className="wizard-step-body">
              <div className="wizard-classify-grid">
                <div className="wizard-classify-card red">
                  <div className="classify-icon">■</div>
                  <h3>Red pass</h3>
                  <p>Vehicle stopped before the light, then resumed after the light turned green or was already green.</p>
                  <div className="classify-evidence">
                    <span>stop detected upstream</span>
                    <span>speed resumed after stop line</span>
                  </div>
                </div>
                <div className="wizard-classify-card green">
                  <div className="classify-icon">●</div>
                  <h3>Green pass</h3>
                  <p>Vehicle crossed without stopping, indicating the light was green during passage.</p>
                  <div className="classify-evidence">
                    <span>no stop cluster detected</span>
                    <span>continuous speed through intersection</span>
                  </div>
                </div>
              </div>
              <div className="wizard-technique">
                <h3>Technique</h3>
                <p>Each pass is classified based on stop location relative to the stop line. If a stop cluster occurs before the stop line and the vehicle resumes movement after it, the pass is labeled "red" (indicating the light was red during the stopped phase). Passes where no stop occurs before the stop line are labeled "green".</p>
              </div>
            </div>
            <div className="wizard-step-nav">
              <button className="btn secondary" onClick={() => onStepChange("stops")} type="button">← Stops</button>
              <button className="btn primary" onClick={() => onStepChange("cycle")} type="button">Next: Cycle →</button>
            </div>
          </div>
        )}

        {step === "cycle" && (
          <div className="wizard-step-view">
            <div className="wizard-step-header">
              <div className="wizard-step-badge">Step 5</div>
              <h2>Estimate cycle length</h2>
              <p>A circular period search picks the strongest repeat interval, currently 60s.</p>
            </div>
            <div className="wizard-step-body">
              <div className="wizard-cycle-display">
                {selectedPrediction && (
                  <div className="cycle-ring">
                    <svg viewBox="0 0 200 200" className="cycle-ring-svg">
                      <circle cx="100" cy="100" r="80" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="20" />
                      <circle
                        cx="100"
                        cy="100"
                        r="80"
                        fill="none"
                        stroke="#7cffb2"
                        strokeWidth="20"
                        strokeDasharray={`${(selectedPrediction.greenDurationSeconds / selectedPrediction.cycleLengthSeconds) * 502} 502`}
                        strokeLinecap="round"
                        transform="rotate(-90 100 100)"
                      />
                      <circle
                        cx="100"
                        cy="100"
                        r="80"
                        fill="none"
                        stroke="#ff5c7a"
                        strokeWidth="20"
                        strokeDasharray={`${(selectedPrediction.redDurationSeconds / selectedPrediction.cycleLengthSeconds) * 502} 502`}
                        strokeDashoffset={`${-(selectedPrediction.greenDurationSeconds / selectedPrediction.cycleLengthSeconds) * 502}`}
                        strokeLinecap="round"
                        transform="rotate(-90 100 100)"
                      />
                      <text x="100" y="90" textAnchor="middle" fill="#edf7ff" fontSize="28" fontWeight="900">{selectedPrediction.cycleLengthSeconds}s</text>
                      <text x="100" y="115" textAnchor="middle" fill="#92a9ba" fontSize="12">cycle</text>
                    </svg>
                    <div className="cycle-legend">
                      <span className="cycle-green-label">Green {selectedPrediction.greenDurationSeconds}s</span>
                      <span className="cycle-red-label">Red {selectedPrediction.redDurationSeconds}s</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="wizard-distribution">
                <h3>Cycle length candidates</h3>
                <div className="distribution-bars">
                  {(selectedPrediction?.cycleLengthDistribution ?? []).slice(0, 5).map((candidate) => (
                    <div key={candidate.cycleLengthSeconds} className="distribution-bar-row">
                      <span className="distribution-bar-label">{candidate.cycleLengthSeconds}s</span>
                      <div className="distribution-bar-track">
                        <div
                          className="distribution-bar-fill"
                          style={{ width: `${Math.max(4, candidate.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="distribution-bar-value">{Math.round(candidate.confidence * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="wizard-technique">
                <h3>Technique</h3>
                <p>Cycle length is estimated using circular period detection on green-start timestamps. Multiple methods are combined: FFT for spectral analysis, autocorrelation for periodicity, and Bayesian inference for confidence weighting. The 60s cycle shown here represents the strongest consensus across methods.</p>
              </div>
            </div>
            <div className="wizard-step-nav">
              <button className="btn secondary" onClick={() => onStepChange("classify")} type="button">← Classify</button>
              <button className="btn primary" onClick={() => onStepChange("phase")} type="button">Next: Phase →</button>
            </div>
          </div>
        )}

        {step === "phase" && (
          <div className="wizard-step-view">
            <div className="wizard-step-header">
              <div className="wizard-step-badge">Step 6</div>
              <h2>Estimate phase windows</h2>
              <p>Bayesian and HMM phase posteriors agree on a green window of 23s and a red window of 37s.</p>
            </div>
            <div className="wizard-step-body">
              <div className="wizard-method-scores">
                <h3>Method confidence scores</h3>
                <div className="method-score-grid">
                  {selectedPrediction && (
                    <>
                      <div className="method-score-item">
                        <span className="method-name">Bayesian</span>
                        <div className="method-bar-track">
                          <div className="method-bar-fill bayesian" style={{ width: `${Math.round((selectedPrediction.bayesianConfidence ?? 0) * 100)}%` }} />
                        </div>
                        <span className="method-value">{Math.round((selectedPrediction.bayesianConfidence ?? 0) * 100)}%</span>
                      </div>
                      <div className="method-score-item">
                        <span className="method-name">HMM</span>
                        <div className="method-bar-track">
                          <div className="method-bar-fill hmm" style={{ width: `${Math.round((selectedPrediction.hmmConfidence ?? 0) * 100)}%` }} />
                        </div>
                        <span className="method-value">{Math.round((selectedPrediction.hmmConfidence ?? 0) * 100)}%</span>
                      </div>
                      <div className="method-score-item">
                        <span className="method-name">DTW</span>
                        <div className="method-bar-track">
                          <div className="method-bar-fill dtw" style={{ width: `${Math.round((selectedPrediction.dtwAlignmentScore ?? 0) * 100)}%` }} />
                        </div>
                        <span className="method-value">{Math.round((selectedPrediction.dtwAlignmentScore ?? 0) * 100)}%</span>
                      </div>
                      <div className="method-score-item">
                        <span className="method-name">Particle</span>
                        <div className="method-bar-track">
                          <div className="method-bar-fill particle" style={{ width: `${Math.max(4, 100 - (selectedPrediction.particleSpreadSeconds ?? 0) * 10)}%` }} />
                        </div>
                        <span className="method-value">{Math.round(selectedPrediction.particleSpreadSeconds ?? 0)}s spread</span>
                      </div>
                      <div className="method-score-item">
                        <span className="method-name">Kalman</span>
                        <div className="method-bar-track">
                          <div className="method-bar-fill kalman" style={{ width: `${Math.round((selectedPrediction.kalmanConfidence ?? 0) * 100)}%` }} />
                        </div>
                        <span className="method-value">{Math.round((selectedPrediction.kalmanConfidence ?? 0) * 100)}%</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="wizard-phase-diagram">
                <div className="phase-timeline">
                  <div className="phase-timeline-track">
                    <div className="phase-green-block" style={{ width: selectedPrediction ? `${(selectedPrediction.greenDurationSeconds / selectedPrediction.cycleLengthSeconds) * 100}%` : "38%" }}>
                      <span>Green {selectedPrediction?.greenDurationSeconds ?? 23}s</span>
                    </div>
                    <div className="phase-red-block" style={{ width: selectedPrediction ? `${(selectedPrediction.redDurationSeconds / selectedPrediction.cycleLengthSeconds) * 100}%` : "62%" }}>
                      <span>Red {selectedPrediction?.redDurationSeconds ?? 37}s</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="wizard-technique">
                <h3>Technique</h3>
                <p>Phase windows are estimated using Bayesian inference to combine prior knowledge with observed pass data, and Hidden Markov Models to model the hidden state sequence (green/red) from observed vehicle behavior. Dynamic Time Warping measures similarity between pass sequences. Particle filters track phase uncertainty, and Kalman filtering provides recursive state estimation with drift correction.</p>
              </div>
            </div>
            <div className="wizard-step-nav">
              <button className="btn secondary" onClick={() => onStepChange("cycle")} type="button">← Cycle</button>
              <button className="btn primary" onClick={() => onStepChange("sync")} type="button">Next: Sync →</button>
            </div>
          </div>
        )}

        {step === "sync" && (
          <div className="wizard-step-view">
            <div className="wizard-step-header">
              <div className="wizard-step-badge">Step 7</div>
              <h2>Synchronize neighboring lights</h2>
              <p>Nearby lights contributed 4 synchronized peers and a 3.9s offset correction.</p>
            </div>
            <div className="wizard-step-body">
              <div className="wizard-sync-display">
                {selectedPrediction && (
                  <div className="sync-stats">
                    <div className="wizard-stat">
                      <strong>{selectedPrediction.neighborSupportCount}</strong>
                      <span>Synchronized peers</span>
                    </div>
                    <div className="wizard-stat">
                      <strong>{selectedPrediction.syncAdjustmentSeconds.toFixed(1)}s</strong>
                      <span>Offset correction</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="wizard-sync-diagram">
                <svg viewBox="0 0 400 200" className="sync-network-svg">
                  <defs>
                    <marker id="sync-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill="#65d6ff" />
                    </marker>
                  </defs>
                  <rect width="400" height="200" rx="16" fill="rgba(5,11,18,0.6)" />
                  <circle cx="200" cy="100" r="20" fill="#ffd166" opacity="0.9" />
                  <text x="200" y="105" textAnchor="middle" fill="#03070d" fontSize="14" fontWeight="900">◆</text>
                  <text x="200" y="145" textAnchor="middle" fill="#92a9ba" fontSize="10">selected</text>
                  {[
                    { x: 80, y: 50 },
                    { x: 320, y: 50 },
                    { x: 80, y: 150 },
                    { x: 320, y: 150 },
                  ].map((pos, i) => (
                    <g key={i}>
                      <line x1="200" y1="100" x2={pos.x} y2={pos.y} stroke="#65d6ff" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#sync-arrow)" opacity="0.6" />
                      <circle cx={pos.x} cy={pos.y} r="12" fill="#65d6ff" opacity="0.4" />
                      <text x={pos.x} y={pos.y + 4} textAnchor="middle" fill="#65d6ff" fontSize="10">●</text>
                    </g>
                  ))}
                </svg>
              </div>
              <div className="wizard-technique">
                <h3>Technique</h3>
                <p>Neighboring traffic lights are identified based on spatial proximity and phase correlation. If multiple nearby lights show similar cycle lengths and phase offsets, their estimates are weighted together to improve confidence. The offset correction adjusts the phase timing based on observed synchronization patterns between adjacent intersections.</p>
              </div>
            </div>
            <div className="wizard-step-nav">
              <button className="btn secondary" onClick={() => onStepChange("phase")} type="button">← Phase</button>
              <button className="btn primary" onClick={() => onStepChange("live")} type="button">Next: Live →</button>
            </div>
          </div>
        )}

        {step === "live" && (
          <div className="wizard-step-view">
            <div className="wizard-step-header">
              <div className="wizard-step-badge">Step 8</div>
              <h2>Update the live estimate</h2>
              <p>The current state is red, with 8s until the next transition and 0s/h drift.</p>
            </div>
            <div className="wizard-step-body">
              {selectedPrediction && (
                <div className="wizard-live-display">
                  <div className="live-state-indicator">
                    <div className={`live-state-circle state-${selectedPrediction.currentState}`}>
                      {selectedPrediction.currentState === "green" ? "●" : "■"}
                    </div>
                    <div className="live-state-info">
                      <strong>Current state: {selectedPrediction.currentState}</strong>
                      <span>Updated {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    </div>
                  </div>
                  <div className="live-metrics-row">
                    <div className="live-metric">
                      <strong>{selectedPrediction.timeUntilTransitionSeconds.toFixed(0)}s</strong>
                      <span>Until transition</span>
                    </div>
                    <div className="live-metric">
                      <strong>{selectedPrediction.cycleLengthSeconds}s</strong>
                      <span>Cycle length</span>
                    </div>
                    <div className="live-metric">
                      <strong>{(selectedPrediction.offsetDriftSecondsPerHour ?? 0).toFixed(1)}s/h</strong>
                      <span>Drift</span>
                    </div>
                  </div>
                  <div className="live-countdown">
                    <div className="countdown-track">
                      <div
                        className={`countdown-progress state-${selectedPrediction.currentState}`}
                        style={{
                          width: selectedPrediction.currentState === "red"
                            ? `${100 - (selectedPrediction.timeUntilTransitionSeconds / selectedPrediction.redDurationSeconds) * 100}%`
                            : `${100 - (selectedPrediction.timeUntilTransitionSeconds / selectedPrediction.greenDurationSeconds) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="countdown-label">
                      {selectedPrediction.currentState === "red" ? "Red" : "Green"} window · {selectedPrediction.currentState === "red" ? selectedPrediction.redDurationSeconds : selectedPrediction.greenDurationSeconds}s total
                    </span>
                  </div>
                </div>
              )}
              <div className="wizard-technique">
                <h3>Technique</h3>
                <p>The live estimate projects the current traffic light state forward using the estimated cycle length, phase offset, and drift rate. Each second, the projection is updated based on elapsed time within the cycle. Drift tracking compensates for clock skew between the vehicle observations and real time, keeping the estimate accurate over extended periods.</p>
              </div>
            </div>
            <div className="wizard-step-nav">
              <button className="btn secondary" onClick={() => onStepChange("sync")} type="button">← Sync</button>
              <button className="btn primary" onClick={() => onStepChange("24h")} type="button">Next: 24h pattern →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
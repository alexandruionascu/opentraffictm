import type { PrecomputedTrafficLightDataset, TrafficLightLocation } from "./types";
import type { LiveTrafficLightPrediction } from "./livePrediction";

type Props = {
  dataset: PrecomputedTrafficLightDataset | null;
  selectedLight: TrafficLightLocation | null;
  selectedPrediction: LiveTrafficLightPrediction | null;
  onBack: () => void;
};

function getTimisoaraHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Bucharest",
  }).formatToParts(date);
  return Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "0", 10) % 24;
}

function confidenceLabel(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

export function TrafficLight24hPage({ dataset, selectedLight, selectedPrediction, onBack }: Props) {
  const currentHour = getTimisoaraHour();
  const profile = selectedPrediction?.hourlyProfile ?? [];

  const hasData = profile.some((s) => s.sampleCount > 0);
  const greenDurations = profile.map((s) => s.greenDurationSeconds);
  const maxGreen = Math.max(...greenDurations, 1);
  const variance = hasData
    ? Math.round(Math.sqrt(greenDurations.reduce((sum, d) => sum + (d - greenDurations[12]) ** 2, 0) / 24))
    : 0;
  const isAdaptive = variance > 8;

  const stabilityScore = selectedPrediction?.temporalStabilityScore ?? 0;

  return (
    <div className="traffic-24h-page">
      <header className="traffic-24h-header">
        <button className="btn secondary" onClick={onBack} type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back to methodology
        </button>
        <div className="traffic-24h-title-block">
          <p className="eyebrow">Step 9</p>
          <h1>24-hour signal distribution</h1>
          <p className="lede">
            {selectedLight ? `Hourly posteriors for ${selectedLight.name}` : "Select a traffic light to see its 24-hour pattern"} — temporal stability is {Math.round(stabilityScore * 100)}%.
          </p>
        </div>
      </header>

      <main className="traffic-24h-content">
        {selectedPrediction && (
          <>
            <section className="traffic-24h-summary">
              <div className="summary-stat">
                <strong>{selectedPrediction.cycleLengthSeconds}s</strong>
                <span>Cycle length</span>
              </div>
              <div className="summary-stat">
                <strong>{selectedPrediction.greenDurationSeconds}s</strong>
                <span>Base green</span>
              </div>
              <div className="summary-stat">
                <strong>{selectedPrediction.redDurationSeconds}s</strong>
                <span>Base red</span>
              </div>
              <div className="summary-stat">
                <strong>{selectedPrediction.phaseOffsetSeconds.toFixed(1)}s</strong>
                <span>Phase offset</span>
              </div>
              <div className="summary-stat">
                <strong>{confidenceLabel(selectedPrediction.confidence)}</strong>
                <span>Confidence</span>
              </div>
            </section>

            {isAdaptive && (
              <div className="traffic-adaptive-banner">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                <div>
                  <strong>Adaptive signal detected</strong>
                  <span>{variance}s green-duration variability across the day</span>
                </div>
              </div>
            )}

            <section className="traffic-24h-chart-section">
              <h2>Green/red probability by hour</h2>
              <p className="paper-meta">Bar height shows state probability; opacity indicates evidence strength from {profile.reduce((sum, s) => sum + s.sampleCount, 0)} total samples.</p>
              <div className="traffic-24h-chart">
                <div className="chart-y-axis">
                  <span>100%</span>
                  <span>50%</span>
                  <span>0%</span>
                </div>
                <div className="chart-bars">
                  {(profile.length > 0 ? profile : Array.from({ length: 24 }, (_, h) => ({
                    hourOfDay: h,
                    sampleCount: 0,
                    greenProbability: 0.5,
                    redProbability: 0.5,
                    confidence: 0,
                    phaseOffsetSeconds: selectedPrediction?.phaseOffsetSeconds ?? 0,
                    greenDurationSeconds: selectedPrediction?.greenDurationSeconds ?? 0,
                  }))).map((slice) => {
                    const active = slice.hourOfDay === currentHour;
                    const greenPct = Math.round(slice.greenProbability * 100);
                    const confidence = slice.confidence;
                    return (
                      <div key={slice.hourOfDay} className={`chart-bar-cell ${active ? "active" : ""}`}>
                        <div className="bar-wrap">
                          <div
                            className="bar-green"
                            style={{
                              height: `${greenPct}%`,
                              opacity: 0.4 + confidence * 0.6,
                            }}
                          />
                          <div
                            className="bar-red"
                            style={{
                              height: `${100 - greenPct}%`,
                              opacity: 0.4 + confidence * 0.6,
                            }}
                          />
                        </div>
                        <span className="bar-hour">{String(slice.hourOfDay).padStart(2, "0")}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="chart-legend">
                <span className="legend-green">Green probability</span>
                <span className="legend-red">Red probability</span>
                <span className="legend-note">Bar height = probability · opacity = evidence strength</span>
              </div>
            </section>

            <section className="traffic-24h-table-section">
              <h2>Hourly breakdown</h2>
              <div className="hourly-table">
                <div className="hourly-table-header">
                  <span>Hour</span>
                  <span>Green %</span>
                  <span>Red %</span>
                  <span>Samples</span>
                  <span>Green dur</span>
                  <span>Confidence</span>
                </div>
                {profile.filter((s) => s.sampleCount > 0).map((slice) => (
                  <div key={slice.hourOfDay} className={`hourly-table-row ${slice.hourOfDay === currentHour ? "current" : ""}`}>
                    <span className="row-hour">{String(slice.hourOfDay).padStart(2, "0")}:00</span>
                    <span className="row-green">{Math.round(slice.greenProbability * 100)}%</span>
                    <span className="row-red">{Math.round(slice.redProbability * 100)}%</span>
                    <span className="row-samples">{slice.sampleCount}</span>
                    <span className="row-dur">{slice.greenDurationSeconds.toFixed(0)}s</span>
                    <span className="row-conf">{confidenceLabel(slice.confidence)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="traffic-24h-methods">
              <h2>Better stack: Bayesian, HMM, DTW, Particle, Kalman</h2>
              <div className="methods-grid">
                <div className="method-item">
                  <span className="method-label">Bayes</span>
                  <div className="method-bar-track">
                    <div className="method-bar-fill bayesian" style={{ width: `${Math.round((selectedPrediction.bayesianConfidence ?? 0) * 100)}%` }} />
                  </div>
                  <span className="method-pct">{Math.round((selectedPrediction.bayesianConfidence ?? 0) * 100)}%</span>
                </div>
                <div className="method-item">
                  <span className="method-label">HMM</span>
                  <div className="method-bar-track">
                    <div className="method-bar-fill hmm" style={{ width: `${Math.round((selectedPrediction.hmmConfidence ?? 0) * 100)}%` }} />
                  </div>
                  <span className="method-pct">{Math.round((selectedPrediction.hmmConfidence ?? 0) * 100)}%</span>
                </div>
                <div className="method-item">
                  <span className="method-label">DTW</span>
                  <div className="method-bar-track">
                    <div className="method-bar-fill dtw" style={{ width: `${Math.round((selectedPrediction.dtwAlignmentScore ?? 0) * 100)}%` }} />
                  </div>
                  <span className="method-pct">{Math.round((selectedPrediction.dtwAlignmentScore ?? 0) * 100)}%</span>
                </div>
                <div className="method-item">
                  <span className="method-label">Particle spread</span>
                  <div className="method-bar-track">
                    <div className="method-bar-fill particle" style={{ width: `${Math.max(4, 100 - (selectedPrediction.particleSpreadSeconds ?? 0) * 10)}%` }} />
                  </div>
                  <span className="method-pct">{Math.round(selectedPrediction.particleSpreadSeconds ?? 0)}s</span>
                </div>
                <div className="method-item">
                  <span className="method-label">Kalman</span>
                  <div className="method-bar-track">
                    <div className="method-bar-fill kalman" style={{ width: `${Math.round((selectedPrediction.kalmanConfidence ?? 0) * 100)}%` }} />
                  </div>
                  <span className="method-pct">{Math.round((selectedPrediction.kalmanConfidence ?? 0) * 100)}%</span>
                </div>
              </div>
            </section>
          </>
        )}

        {!selectedPrediction && (
          <div className="traffic-24h-empty">
            <p>Select a traffic light on the map to see its 24-hour timing distribution.</p>
          </div>
        )}
      </main>
    </div>
  );
}
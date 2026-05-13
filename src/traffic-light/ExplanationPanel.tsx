import type { LiveTrafficLightPrediction } from "./livePrediction";
import type { TrafficLightLocation, TrafficLightPass } from "./types";

type Props = {
  lights: TrafficLightLocation[];
  selectedLight: TrafficLightLocation | null;
  selectedPrediction: LiveTrafficLightPrediction | null;
  selectedPasses: TrafficLightPass[];
  topPredictions: LiveTrafficLightPrediction[];
  sparsePredictions: LiveTrafficLightPrediction[];
  supportedPredictions: LiveTrafficLightPrediction[];
  onSelectLight: (lightId: string) => void;
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

export function ExplanationPanel({
  lights,
  selectedLight,
  selectedPrediction,
  selectedPasses,
  topPredictions,
  sparsePredictions,
  supportedPredictions,
  onSelectLight,
}: Props) {
  const currentHour = getTimisoaraHour();
  return (
    <aside className="traffic-light-panel">
      <div className="traffic-light-panel-head">
        <div>
          <p className="eyebrow">Traffic-light inference</p>
          <h1>Live signal timing from STPT GPS traces</h1>
          <p className="lede">
            Select a traffic light on the map. The inference uses the mock route traces in this repo, but the
            pipeline matches the structure you will use for live feeds later.
          </p>
        </div>
      </div>

      <section className="traffic-light-rank-card">
        <div className="traffic-light-section-head">
          <h2>Best examples first</h2>
          <span>{supportedPredictions.length} lights with pass support</span>
        </div>
        <div className="traffic-light-rank-list">
          {topPredictions.map((prediction, index) => {
            const light = lights.find((item) => item.id === prediction.lightId);
            const active = prediction.lightId === selectedLight?.id;
            return (
              <button
                key={prediction.lightId}
                className={active ? "traffic-light-rank-row active" : "traffic-light-rank-row"}
                onClick={() => onSelectLight(prediction.lightId)}
                type="button"
              >
                <div className="traffic-light-rank-index">{index + 1}</div>
                <div className="traffic-light-rank-body">
                  <strong>{light?.name ?? prediction.lightId}</strong>
                  <span>
                    {prediction.passCount} passes · {prediction.routeCount} routes · {Math.round(prediction.confidence * 100)}% confidence
                  </span>
                </div>
                <div className={`traffic-light-rank-state state-${prediction.currentState}`}>
                  {prediction.currentState}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="traffic-light-summary-grid">
        <div className="traffic-light-summary-card">
          <span>Cycle</span>
          <strong>{selectedPrediction ? `${selectedPrediction.cycleLengthSeconds}s` : "—"}</strong>
        </div>
        <div className="traffic-light-summary-card">
          <span>Green</span>
          <strong>{selectedPrediction ? `${selectedPrediction.greenDurationSeconds}s` : "—"}</strong>
        </div>
        <div className="traffic-light-summary-card">
          <span>Red</span>
          <strong>{selectedPrediction ? `${selectedPrediction.redDurationSeconds}s` : "—"}</strong>
        </div>
        <div className="traffic-light-summary-card">
          <span>Offset</span>
          <strong>{selectedPrediction ? `${selectedPrediction.phaseOffsetSeconds.toFixed(1)}s` : "—"}</strong>
        </div>
        <div className="traffic-light-summary-card">
          <span>State</span>
          <strong>{selectedPrediction ? selectedPrediction.currentState : "—"}</strong>
        </div>
        <div className="traffic-light-summary-card">
          <span>Confidence</span>
          <strong>{selectedPrediction ? confidenceLabel(selectedPrediction.confidence) : "—"}</strong>
        </div>
      </section>

      <section className="traffic-light-detail-card">
        <div className="traffic-light-detail-head">
          <div>
            <h2>{selectedLight ? selectedLight.name : "Pick a traffic light"}</h2>
            <p>
              {selectedLight
                ? `${selectedPasses.length} inferred passes, ${selectedPrediction?.routeCount ?? 0} route combinations`
                : "The map markers are color-coded by the current inferred state."}
            </p>
          </div>
          <div className={`traffic-light-state-badge state-${selectedPrediction?.currentState ?? "unknown"}`}>
            {selectedPrediction ? selectedPrediction.currentState : "unknown"}
          </div>
        </div>

        {selectedPrediction ? (
          <>
            <div className="traffic-light-detail-metrics">
              <div>
                <span>Time left</span>
                <strong>{selectedPrediction.timeUntilTransitionSeconds.toFixed(0)}s</strong>
              </div>
              <div>
                <span>Green starts</span>
                <strong>{selectedPrediction.greenStartCount}</strong>
              </div>
              <div>
                <span>Stops</span>
                <strong>{selectedPrediction.stopPassCount}</strong>
              </div>
              <div>
                <span>Neighbors</span>
                <strong>{selectedPrediction.neighborSupportCount}</strong>
              </div>
            </div>
            <p className="traffic-light-explanation">{selectedPrediction.explanation}</p>
            <div className="traffic-light-evidence">
              {selectedPrediction.evidenceSummary.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <div className="traffic-light-method-grid">
              <div>
                <span>Bayesian</span>
                <strong>{Math.round((selectedPrediction.bayesianConfidence ?? 0) * 100)}%</strong>
              </div>
              <div>
                <span>HMM</span>
                <strong>{Math.round((selectedPrediction.hmmConfidence ?? 0) * 100)}%</strong>
              </div>
              <div>
                <span>DTW</span>
                <strong>{Math.round((selectedPrediction.dtwAlignmentScore ?? 0) * 100)}%</strong>
              </div>
              <div>
                <span>Particle spread</span>
                <strong>{Math.round(selectedPrediction.particleSpreadSeconds ?? 0)}s</strong>
              </div>
              <div>
                <span>Kalman</span>
                <strong>{Math.round((selectedPrediction.kalmanConfidence ?? 0) * 100)}%</strong>
              </div>
              <div>
                <span>Drift</span>
                <strong>{(selectedPrediction.offsetDriftSecondsPerHour ?? 0).toFixed(1)}s/h</strong>
              </div>
            </div>
            <section className="traffic-light-visual-card">
              <div className="traffic-light-section-head">
                <h2>Step-by-step visual markers</h2>
                <span>What the page is showing right now</span>
              </div>
              <div className="traffic-light-visual-stepper">
                {(selectedPrediction.pipelineStages ?? []).map((stage, index) => (
                  <div key={stage.id} className={stage.done ? "traffic-light-visual-step done" : "traffic-light-visual-step pending"}>
                    <div className="traffic-light-visual-step-index">{index + 1}</div>
                    <div className="traffic-light-visual-step-body">
                      <strong>{stage.title}</strong>
                      <p>{stage.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="traffic-light-hourly-card">
              <div className="traffic-light-section-head">
                <h2>24-hour posterior</h2>
                <span>
                  This is the distribution users should trust: hourly state probability with the amount of evidence
                  behind each hour.
                </span>
              </div>
              <div className="traffic-light-hourly-grid">
                {(selectedPrediction.hourlyProfile ??
                  Array.from({ length: 24 }, (_, hourOfDay) => ({
                    hourOfDay,
                    sampleCount: 0,
                    greenProbability: 0.5,
                    redProbability: 0.5,
                    confidence: 0,
                    phaseOffsetSeconds: selectedPrediction.phaseOffsetSeconds,
                    greenDurationSeconds: selectedPrediction.greenDurationSeconds,
                  }))).map((slice) => {
                  const active = slice.hourOfDay === currentHour;
                  const greenShare = Math.round(slice.greenProbability * 100);
                  const redShare = Math.round(slice.redProbability * 100);
                  const background = `linear-gradient(90deg, rgba(46, 204, 113, 0.82) 0%, rgba(46, 204, 113, 0.82) ${greenShare}%, rgba(239, 68, 68, 0.72) ${greenShare}%, rgba(239, 68, 68, 0.72) 100%)`;
                  return (
                    <div key={slice.hourOfDay} className={active ? "traffic-light-hourly-cell active" : "traffic-light-hourly-cell"}>
                      <span>{String(slice.hourOfDay).padStart(2, "0")}:00</span>
                      <div className="traffic-light-hourly-bar" style={{ background }}>
                        <i style={{ width: `${Math.max(6, slice.confidence * 100)}%` }} />
                      </div>
                      <small>
                        {slice.sampleCount > 0
                          ? `${greenShare}% green / ${redShare}% red · ${slice.sampleCount} passes`
                          : "no samples"}
                      </small>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <p className="traffic-light-explanation">
            Click a light to see its timing estimate, phase offset, and how the classifier handled bus-stop dwell
            time versus signal delay.
          </p>
        )}
      </section>

      <section className="traffic-light-step-list">
        <div className="traffic-light-section-head">
          <h2>Step-by-step pipeline</h2>
          <span>Baseline, better, strong, and very strong stages</span>
        </div>
        {(selectedPrediction?.pipelineStages ?? []).map((stage) => (
          <div key={stage.id} className={`traffic-light-step ${stage.done ? "done" : "pending"}`}>
            <strong>{stage.title}</strong>
            <p>{stage.detail}</p>
          </div>
        ))}
      </section>

      <section className="traffic-light-list-card">
        <div className="traffic-light-section-head">
          <h2>Low-support lights</h2>
          <span>Kept out of the way unless you need them</span>
        </div>
        <div className="traffic-light-list">
          {sparsePredictions.map((prediction) => {
            const light = lights.find((item) => item.id === prediction.lightId);
            return (
              <button
                key={prediction.lightId}
                className={prediction.lightId === selectedLight?.id ? "traffic-light-list-row active" : "traffic-light-list-row"}
                onClick={() => onSelectLight(prediction.lightId)}
                type="button"
              >
                <strong>{light?.name ?? prediction.lightId}</strong>
                <span>
                  no passes · {Math.round(prediction.confidence * 100)}% confidence · {prediction.currentState}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="traffic-light-list-card">
        <div className="traffic-light-section-head">
          <h2>Traffic lights</h2>
          <span>{lights.length} OSM markers loaded</span>
        </div>
        <div className="traffic-light-list">
          {lights.slice(0, 12).map((light) => (
            <button
              key={light.id}
              className={light.id === selectedLight?.id ? "traffic-light-list-row active" : "traffic-light-list-row"}
              onClick={() => onSelectLight(light.id)}
              type="button"
            >
              <strong>{light.name}</strong>
              <span>
                {light.lat.toFixed(5)}, {light.lng.toFixed(5)}
              </span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

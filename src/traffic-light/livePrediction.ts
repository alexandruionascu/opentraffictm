import { modulo } from "./mapMatching";
import type { TrafficLightEstimate } from "./types";

export interface LiveTrafficLightPrediction extends TrafficLightEstimate {
  livePhaseSeconds: number;
  nextState: "green" | "red" | "unknown";
  nextTransitionInSeconds: number;
  nextTransitionLabel: string;
}

export function projectTrafficLightState(
  estimate: TrafficLightEstimate,
  now = Date.now(),
): LiveTrafficLightPrediction {
  const cycle = Math.max(1, estimate.cycleLengthSeconds);
  const hoursSinceAnchor = (now / 1000 - estimate.anchorTimestamp) / 3600;
  const adjustedOffset = modulo(
    estimate.phaseOffsetSeconds + (estimate.offsetDriftSecondsPerHour ?? 0) * hoursSinceAnchor,
    cycle,
  );
  const livePhaseSeconds = modulo(now / 1000 - estimate.anchorTimestamp, cycle);
  const withinGreen = (() => {
    if (estimate.greenDurationSeconds >= cycle) {
      return true;
    }
    const end = modulo(adjustedOffset + estimate.greenDurationSeconds, cycle);
    return adjustedOffset <= end
      ? livePhaseSeconds >= adjustedOffset && livePhaseSeconds < end
      : livePhaseSeconds >= adjustedOffset || livePhaseSeconds < end;
  })();
  const nextState = estimate.passCount >= 2 ? (withinGreen ? "green" : "red") : "unknown";
  const nextTransitionInSeconds = (() => {
    if (estimate.greenDurationSeconds >= cycle) {
      return 0;
    }
    if (withinGreen) {
      return modulo(adjustedOffset + estimate.greenDurationSeconds - livePhaseSeconds, cycle);
    }
    return modulo(adjustedOffset - livePhaseSeconds, cycle);
  })();
  const nextTransitionLabel =
    nextState === "green" ? "red" : nextState === "red" ? "green" : "unknown";

  return {
    ...estimate,
    currentState: nextState,
    timeUntilTransitionSeconds: nextTransitionInSeconds,
    livePhaseSeconds,
    nextState,
    nextTransitionInSeconds,
    nextTransitionLabel,
  };
}

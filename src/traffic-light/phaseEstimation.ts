import { circularConcentration, circularMean, modulo } from "./mapMatching";
import type {
  TrafficLightEstimate,
  TrafficLightLocation,
  TrafficLightPass,
  TrafficHourlyStateSlice,
  TrafficPhaseState,
} from "./types";

const timisoaraHourFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Bucharest",
});

function buildHistogram(passes: TrafficLightPass[], anchorTimestamp: number, cycleLengthSeconds: number) {
  const green = new Array<number>(cycleLengthSeconds).fill(0);
  const red = new Array<number>(cycleLengthSeconds).fill(0);

  for (const pass of passes) {
    const phase = modulo((pass.crossingTimestamp - anchorTimestamp) / 1000, cycleLengthSeconds);
    const index = Math.floor(phase);
    if (pass.passState === "red") {
      red[index] += pass.confidence;
    } else if (pass.passState === "green") {
      green[index] += pass.confidence;
    }
  }

  const smooth = (series: number[]) =>
    series.map((_, index) => {
      let total = 0;
      let weight = 0;
      for (let offset = -3; offset <= 3; offset += 1) {
        const value = series[modulo(index + offset, series.length)];
        const kernel = offset === 0 ? 3 : offset === -1 || offset === 1 ? 2 : 1;
        total += value * kernel;
        weight += kernel;
      }
      return total / weight;
    });

  return { green: smooth(green), red: smooth(red) };
}

function isPhaseWithinWindow(phase: number, start: number, duration: number, cycle: number) {
  if (duration >= cycle) {
    return true;
  }

  const end = modulo(start + duration, cycle);
  return start <= end ? phase >= start && phase < end : phase >= start || phase < end;
}

function phaseDistanceToWindowEnd(phase: number, start: number, duration: number, cycle: number) {
  if (duration >= cycle) {
    return 0;
  }

  if (isPhaseWithinWindow(phase, start, duration, cycle)) {
    return modulo(start + duration - phase, cycle);
  }

  return modulo(start - phase, cycle);
}

type PhaseSample = {
  phase: number;
  timestampSeconds: number;
  routeKey: string;
  passState: "green" | "red";
  confidence: number;
};

type WindowEstimate = {
  start: number;
  duration: number;
  score: number;
};

type BayesianResult = {
  posterior: number[];
  bestBin: number;
  confidence: number;
  entropy: number;
};

type HMMResult = {
  window: WindowEstimate;
  confidence: number;
  statePath: ("green" | "red")[];
};

type ParticleResult = {
  offsetSeconds: number;
  driftSecondsPerHour: number;
  spreadSeconds: number;
  confidence: number;
};

type KalmanResult = {
  offsetSeconds: number;
  driftSecondsPerHour: number;
  confidence: number;
};

type DailyProfileResult = {
  hourlyProfile: TrafficHourlyStateSlice[];
  temporalStabilityScore: number;
};

type CycleLengthResult = {
  cycleLengthSeconds: number;
  anchorTimestamp: number;
  cycleConfidence: number;
  distribution: TrafficLightEstimate["cycleLengthDistribution"];
};

function circularDistance(a: number, b: number, cycle: number) {
  const raw = Math.abs(modulo(a, cycle) - modulo(b, cycle));
  return Math.min(raw, cycle - raw);
}

function softmax(values: number[]) {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  return exps.map((value) => value / total);
}

function normalizedEntropy(probabilities: number[]) {
  if (!probabilities.length) return 1;
  const safe = probabilities.map((value) => Math.max(1e-9, value));
  const entropy = -safe.reduce((sum, value) => sum + value * Math.log(value), 0);
  return entropy / Math.log(probabilities.length);
}

function buildPhaseSamples(
  passes: TrafficLightPass[],
  cycleLengthSeconds: number,
  anchorTimestamp: number,
): PhaseSample[] {
  return passes
    .filter((pass): pass is TrafficLightPass & { passState: "green" | "red" } => pass.passState !== "unknown")
    .map((pass) => ({
      phase: modulo(pass.crossingTimestamp / 1000 - anchorTimestamp, cycleLengthSeconds),
      timestampSeconds: pass.crossingTimestamp / 1000,
      routeKey: `${pass.routeId}:${pass.directionId ?? ""}`,
      passState: pass.passState,
      confidence: Math.max(0.1, Math.min(1, pass.confidence)),
    }))
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

function timisoaraHourOfDay(timestampSeconds: number) {
  const parts = timisoaraHourFormatter.formatToParts(new Date(timestampSeconds * 1000));
  const value = parts.find((part) => part.type === "hour")?.value ?? "0";
  return Number.parseInt(value, 10) % 24;
}

function buildDailyProfile(
  samples: PhaseSample[],
  cycleLengthSeconds: number,
  baseGreenDurationSeconds: number,
  baseOffsetSeconds: number,
): DailyProfileResult {
  const buckets = Array.from({ length: 24 }, (_, hourOfDay) => ({
    hourOfDay,
    greenWeight: 0,
    redWeight: 0,
    phaseSum: 0,
    phaseWeight: 0,
    durationSum: 0,
    durationWeight: 0,
  }));

  for (const sample of samples) {
    const bucket = buckets[timisoaraHourOfDay(sample.timestampSeconds)];
    const phaseDrift = modulo(sample.phase - baseOffsetSeconds, cycleLengthSeconds);
    bucket.phaseSum += phaseDrift * sample.confidence;
    bucket.phaseWeight += sample.confidence;
    bucket.durationSum += baseGreenDurationSeconds * sample.confidence;
    bucket.durationWeight += sample.confidence;
    if (sample.passState === "green") {
      bucket.greenWeight += sample.confidence;
    } else {
      bucket.redWeight += sample.confidence;
    }
  }

  const hourlyProfile = buckets.map((bucket) => {
    const total = bucket.greenWeight + bucket.redWeight;
    const sampleCount = Math.round(total);
    const greenProbability = total > 0 ? bucket.greenWeight / total : 0.5;
    const redProbability = total > 0 ? bucket.redWeight / total : 0.5;
    const phaseOffsetSeconds = bucket.phaseWeight > 0 ? modulo(bucket.phaseSum / bucket.phaseWeight + baseOffsetSeconds, cycleLengthSeconds) : baseOffsetSeconds;
    const greenDurationSeconds = bucket.durationWeight > 0 ? bucket.durationSum / bucket.durationWeight : baseGreenDurationSeconds;
    const confidence =
      total <= 0
        ? 0.08
        : Math.max(
            0.12,
            Math.min(
              0.98,
              (1 - normalizedEntropy([greenProbability, redProbability])) *
                Math.min(1, total / 6) *
                (bucket.phaseWeight > 0 ? 0.65 + Math.min(0.35, bucket.phaseWeight / 8) : 0.5),
            ),
          );
    return {
      hourOfDay: bucket.hourOfDay,
      sampleCount,
      greenProbability,
      redProbability,
      confidence,
      phaseOffsetSeconds,
      greenDurationSeconds,
    };
  });

  const temporalStabilityScore = hourlyProfile.length
    ? hourlyProfile.reduce((sum, slice) => sum + slice.confidence, 0) / hourlyProfile.length
    : 0;

  return { hourlyProfile, temporalStabilityScore };
}

function estimateBayesianPosterior(samples: PhaseSample[], cycleLengthSeconds: number): BayesianResult {
  const bins = Math.max(1, cycleLengthSeconds);
  const greenBins = new Array<number>(bins).fill(0);
  const redBins = new Array<number>(bins).fill(0);
  const sigma = Math.max(1.8, cycleLengthSeconds * 0.035);

  for (const sample of samples) {
    for (let bin = 0; bin < bins; bin += 1) {
      const distance = circularDistance(bin, sample.phase, bins);
      const kernel = Math.exp(-0.5 * (distance / sigma) ** 2) * sample.confidence;
      if (sample.passState === "green") {
        greenBins[bin] += kernel;
      } else {
        redBins[bin] += kernel;
      }
    }
  }

  const posterior = softmax(greenBins.map((greenValue, index) => greenValue - redBins[index]));
  const entropy = normalizedEntropy(posterior);
  const bestBin = posterior.reduce((best, value, index) => (value > posterior[best] ? index : best), 0);
  return {
    posterior,
    bestBin,
    confidence: Math.max(0.1, Math.min(0.98, 1 - entropy)),
    entropy,
  };
}

function estimateHmmWindow(samples: PhaseSample[], cycleLengthSeconds: number, posterior: BayesianResult): HMMResult {
  const bins = Math.max(1, cycleLengthSeconds);
  const emissions = Array.from({ length: bins }, (_, bin) => {
    const greenEmission = samples.reduce((total, sample) => {
      const distance = circularDistance(bin, sample.phase, bins);
      const kernel = Math.exp(-0.5 * (distance / Math.max(2.2, cycleLengthSeconds * 0.045)) ** 2) * sample.confidence;
      return total + (sample.passState === "green" ? kernel : 0);
    }, 0);
    const redEmission = samples.reduce((total, sample) => {
      const distance = circularDistance(bin, sample.phase, bins);
      const kernel = Math.exp(-0.5 * (distance / Math.max(2.2, cycleLengthSeconds * 0.045)) ** 2) * sample.confidence;
      return total + (sample.passState === "red" ? kernel : 0);
    }, 0);
    return {
      green: Math.log1p(greenEmission + 0.18),
      red: Math.log1p(redEmission + 0.18),
    };
  });

  const stayScore = Math.log(0.985);
  const switchScore = Math.log(0.015);
  const greenScores = new Array<number>(bins).fill(Number.NEGATIVE_INFINITY);
  const redScores = new Array<number>(bins).fill(Number.NEGATIVE_INFINITY);
  const backGreen = new Array<number>(bins).fill(0);
  const backRed = new Array<number>(bins).fill(0);

  greenScores[0] = emissions[0].green + Math.log(Math.max(1e-6, posterior.posterior[posterior.bestBin]));
  redScores[0] = emissions[0].red + Math.log(Math.max(1e-6, 1 - posterior.posterior[posterior.bestBin]));

  for (let bin = 1; bin < bins; bin += 1) {
    const fromGreenStay = greenScores[bin - 1] + stayScore;
    const fromRedToGreen = redScores[bin - 1] + switchScore;
    if (fromGreenStay >= fromRedToGreen) {
      greenScores[bin] = fromGreenStay + emissions[bin].green;
      backGreen[bin] = 1;
    } else {
      greenScores[bin] = fromRedToGreen + emissions[bin].green;
      backGreen[bin] = 0;
    }

    const fromRedStay = redScores[bin - 1] + stayScore;
    const fromGreenToRed = greenScores[bin - 1] + switchScore;
    if (fromRedStay >= fromGreenToRed) {
      redScores[bin] = fromRedStay + emissions[bin].red;
      backRed[bin] = 1;
    } else {
      redScores[bin] = fromGreenToRed + emissions[bin].red;
      backRed[bin] = 0;
    }
  }

  const finalGreenScore = greenScores[bins - 1];
  const finalRedScore = redScores[bins - 1];
  const statePath = new Array<"green" | "red">(bins);
  let state: "green" | "red" = finalGreenScore >= finalRedScore ? "green" : "red";

  for (let bin = bins - 1; bin >= 0; bin -= 1) {
    statePath[bin] = state;
    if (bin === 0) break;
    const cameFromSame = state === "green" ? backGreen[bin] : backRed[bin];
    state = cameFromSame ? state : state === "green" ? "red" : "green";
  }

  const segments: Array<{ state: "green" | "red"; start: number; length: number }> = [];
  let segmentStart = 0;
  for (let bin = 1; bin <= bins; bin += 1) {
    if (bin === bins || statePath[bin] !== statePath[bin - 1]) {
      segments.push({ state: statePath[bin - 1], start: segmentStart, length: bin - segmentStart });
      segmentStart = bin;
    }
  }
  if (segments.length > 1 && segments[0].state === segments[segments.length - 1].state) {
    const merged = {
      state: segments[0].state,
      start: segments[segments.length - 1].start,
      length: segments[0].length + segments[segments.length - 1].length,
    };
    segments.splice(segments.length - 1, 1);
    segments[0] = merged;
  }

  const greenSegments = segments.filter((segment) => segment.state === "green");
  const bestGreen = greenSegments.length
    ? greenSegments.reduce((best, segment) => (segment.length > best.length ? segment : best), greenSegments[0])
    : { state: "green" as const, start: 0, length: Math.max(20, Math.round(cycleLengthSeconds * 0.4)) };
  const totalMargin = segments.reduce((sum, segment) => {
    const segmentScore = segment.state === "green"
      ? emissions.slice(segment.start, segment.start + segment.length).reduce((total, item) => total + item.green - item.red, 0)
      : emissions.slice(segment.start, segment.start + segment.length).reduce((total, item) => total + item.red - item.green, 0);
    return sum + Math.max(0, segmentScore);
  }, 0);
  return {
    window: {
      start: modulo(bestGreen.start, bins),
      duration: Math.max(20, Math.min(bins, bestGreen.length)),
      score: Math.max(0.12, Math.min(1, totalMargin / Math.max(1, bins * 0.7))),
    },
    confidence: Math.max(
      0.12,
      Math.min(
        0.98,
        0.28 +
          (segments.length ? 1 / segments.length : 0.24) * 0.26 +
          (greenSegments.length ? greenSegments[0].length / bins : 0.2) * 0.24 +
          (1 - posterior.entropy) * 0.22,
      ),
    ),
    statePath,
  };
}

function dtwDistance(a: number[], b: number[], cycleLengthSeconds: number) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(Number.POSITIVE_INFINITY));
  matrix[0][0] = 0;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = circularDistance(a[row - 1], b[col - 1], cycleLengthSeconds) / cycleLengthSeconds;
      matrix[row][col] = cost + Math.min(matrix[row - 1][col], matrix[row][col - 1], matrix[row - 1][col - 1]);
    }
  }
  return matrix[rows - 1][cols - 1] / Math.max(1, a.length + b.length);
}

function estimateRouteAlignment(samples: PhaseSample[], cycleLengthSeconds: number, window: WindowEstimate) {
  const routeGroups = new Map<string, PhaseSample[]>();
  for (const sample of samples) {
    const bucket = routeGroups.get(sample.routeKey) ?? [];
    bucket.push(sample);
    routeGroups.set(sample.routeKey, bucket);
  }

  const allPhases = samples.map((sample) => sample.phase).sort((a, b) => a - b);
  const consensus = allPhases.slice(0, Math.max(4, Math.min(10, allPhases.length)));
  if (!consensus.length) {
    return { alignmentScore: 0.12, routeConsensusOffset: window.start };
  }

  const routeScores: number[] = [];
  const routeOffsets: number[] = [];
  for (const routeSamples of routeGroups.values()) {
    if (routeSamples.length < 2) continue;
    const routePhases = routeSamples.map((sample) => sample.phase).sort((a, b) => a - b);
    const score = dtwDistance(routePhases, consensus, cycleLengthSeconds);
    routeScores.push(score);
    routeOffsets.push(circularMean(routePhases, cycleLengthSeconds));
  }

  const alignmentScore = routeScores.length
    ? Math.max(0.1, Math.min(0.98, 1 - routeScores.reduce((sum, value) => sum + value, 0) / routeScores.length))
    : 0.18;
  return {
    alignmentScore,
    routeConsensusOffset: routeOffsets.length ? circularMean(routeOffsets, cycleLengthSeconds) : window.start,
  };
}

function estimateParticlePosterior(
  samples: PhaseSample[],
  cycleLengthSeconds: number,
  window: WindowEstimate,
  routeConsensusOffset: number,
): ParticleResult {
  type Particle = { offset: number; drift: number; weight: number };
  const particleCount = 180;
  const initialSpread = Math.max(5, Math.min(24, cycleLengthSeconds * 0.14));
  let particles: Particle[] = Array.from({ length: particleCount }, (_, index) => {
    const jitter = ((index / Math.max(1, particleCount - 1)) - 0.5) * 2;
    return {
      offset: modulo(window.start + jitter * initialSpread + (routeConsensusOffset - window.start) * 0.2, cycleLengthSeconds),
      drift: jitter * 1.1,
      weight: 1 / particleCount,
    };
  });

  let previousTimestamp = samples[0]?.timestampSeconds ?? 0;
  for (const sample of samples) {
    const deltaHours = Math.max(0, (sample.timestampSeconds - previousTimestamp) / 3600);
    previousTimestamp = sample.timestampSeconds;

    for (const particle of particles) {
      particle.offset = modulo(particle.offset + particle.drift * deltaHours, cycleLengthSeconds);
      const withinGreen = isPhaseWithinWindow(sample.phase, particle.offset, window.duration, cycleLengthSeconds);
      const likelihood =
        sample.passState === "green"
          ? withinGreen
            ? 0.95
            : 0.12
          : withinGreen
            ? 0.1
            : 0.88;
      const residual = circularDistance(sample.phase, particle.offset, cycleLengthSeconds);
      const residualFactor = Math.exp(-0.5 * (residual / Math.max(2.8, cycleLengthSeconds * 0.05)) ** 2);
      particle.weight *= Math.max(1e-5, likelihood * residualFactor * (0.7 + sample.confidence * 0.3));
    }

    const total = particles.reduce((sum, particle) => sum + particle.weight, 0) || 1;
    for (const particle of particles) {
      particle.weight /= total;
    }

    const effectiveSampleSize = 1 / particles.reduce((sum, particle) => sum + particle.weight ** 2, 0);
    if (effectiveSampleSize < particleCount * 0.55) {
      const cumulative: number[] = [];
      particles.reduce((sum, particle, index) => {
        const next = sum + particle.weight;
        cumulative[index] = next;
        return next;
      }, 0);
      const resampled: Particle[] = [];
      for (let index = 0; index < particleCount; index += 1) {
        const target = (index + Math.random()) / particleCount;
        const sourceIndex = cumulative.findIndex((value) => value >= target);
        const source = particles[Math.max(0, sourceIndex)];
        resampled.push({ ...source, weight: 1 / particleCount });
      }
      particles = resampled;
    }
  }

  const offsets = particles.map((particle) => particle.offset);
  const drifts = particles.map((particle) => particle.drift);
  const weights = particles.map((particle) => particle.weight);
  const offsetSeconds = circularMean(offsets, cycleLengthSeconds);
  const driftSecondsPerHour = weights.reduce((sum, weight, index) => sum + drifts[index] * weight, 0);
  const spreadSeconds = Math.sqrt(
    weights.reduce((sum, weight, index) => sum + circularDistance(offsets[index], offsetSeconds, cycleLengthSeconds) ** 2 * weight, 0),
  );
  const confidence = Math.max(0.1, Math.min(0.98, 1 - spreadSeconds / Math.max(8, cycleLengthSeconds * 0.25)));

  return {
    offsetSeconds,
    driftSecondsPerHour,
    spreadSeconds,
    confidence,
  };
}

function estimateKalmanDrift(
  samples: PhaseSample[],
  cycleLengthSeconds: number,
  initialOffset: number,
): KalmanResult {
  const greenStarts = samples.filter((sample) => sample.passState === "green");
  if (greenStarts.length < 2) {
    return {
      offsetSeconds: initialOffset,
      driftSecondsPerHour: 0,
      confidence: 0.18,
    };
  }

  let offset = initialOffset;
  let drift = 0;
  let p00 = 18;
  let p01 = 0;
  let p10 = 0;
  let p11 = 1.5;
  let previousHours = greenStarts[0].timestampSeconds / 3600;

  for (const sample of greenStarts) {
    const hours = sample.timestampSeconds / 3600;
    const dt = Math.max(0, hours - previousHours);
    previousHours = hours;

    const f00 = 1;
    const f01 = dt;
    const f10 = 0;
    const f11 = 1;
    const q00 = 0.18 + dt * 0.08;
    const q11 = 0.05 + dt * 0.03;

    const predictedOffset = offset + drift * dt;
    const predictedDrift = drift;
    const np00 = f00 * p00 * f00 + f01 * p10 + p01 * f10 + f01 * p11 * f11 + q00;
    const np01 = f00 * p01 * f11 + f01 * p11 * f11;
    const np10 = f10 * p00 * f00 + f11 * p10 * f00;
    const np11 = f10 * p01 * f11 + f11 * p11 * f11 + q11;

    const measurement = sample.phase;
    const residual = circularDistance(measurement, modulo(predictedOffset, cycleLengthSeconds), cycleLengthSeconds);
    const signedResidual = modulo(measurement - predictedOffset + cycleLengthSeconds / 2, cycleLengthSeconds) - cycleLengthSeconds / 2;
    const r = Math.max(1.8, cycleLengthSeconds * 0.05);
    const s = np00 + r * r;
    const k0 = np00 / s;
    const k1 = np10 / s;

    offset = predictedOffset + k0 * signedResidual;
    drift = predictedDrift + k1 * signedResidual;
    p00 = (1 - k0) * np00;
    p01 = (1 - k0) * np01;
    p10 = np10 - k1 * np00;
    p11 = np11 - k1 * np01;
    void residual;
  }

  const variance = Math.max(0.1, p00);
  return {
    offsetSeconds: modulo(offset, cycleLengthSeconds),
    driftSecondsPerHour: drift,
    confidence: Math.max(0.12, Math.min(0.98, 1 / (1 + variance / 30))),
  };
}

function estimateCycleLength(passes: TrafficLightPass[]): CycleLengthResult {
  const events = passes
    .filter((pass) => pass.greenStartTimestamp !== undefined)
    .map((pass) => pass.greenStartTimestamp! / 1000)
    .sort((a, b) => a - b);

  if (events.length < 2) {
    const fallback = passes.length >= 4 ? 120 : 90;
    return {
      cycleLengthSeconds: fallback,
      anchorTimestamp: events[0] ?? (passes[0]?.crossingTimestamp ?? Date.now()) / 1000,
      cycleConfidence: 0.18,
      distribution: [
        {
          cycleLengthSeconds: fallback,
          confidence: 0.18,
          sampleCount: events.length,
        },
      ],
    };
  }

  const anchorTimestamp = events[0];
  let bestPeriod = 120;
  let bestScore = -1;
  const candidates: NonNullable<TrafficLightEstimate["cycleLengthDistribution"]> = [];
  const commonCycles = [60, 70, 75, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180];

  for (let period = 60; period <= 180; period += 1) {
    const phases = events.map((event) => modulo(event - anchorTimestamp, period));
    const concentration = circularConcentration(phases, period);
    const support = Math.min(1, phases.length / 10);
    const nearestCommonCycleDistance = Math.min(...commonCycles.map((cycle) => Math.abs(cycle - period)));
    const commonCyclePrior = Math.exp(-0.5 * (nearestCommonCycleDistance / 4) ** 2);
    const score = concentration * 0.62 + support * 0.18 + commonCyclePrior * 0.2;
    candidates.push({
      cycleLengthSeconds: period,
      confidence: Math.max(0, Math.min(1, score)),
      sampleCount: events.length,
    });
    if (score > bestScore) {
      bestScore = score;
      bestPeriod = period;
    }
  }

  return {
    cycleLengthSeconds: bestPeriod,
    anchorTimestamp,
    cycleConfidence: Math.max(0, Math.min(1, bestScore)),
    distribution: candidates
      .sort((a, b) => b.confidence - a.confidence)
      .filter((candidate, index, sorted) =>
        index < 12 &&
        sorted.findIndex((other) => Math.abs(other.cycleLengthSeconds - candidate.cycleLengthSeconds) <= 2) === index,
      )
      .slice(0, 6),
  };
}

function buildPhaseOffsetDistribution(
  cycleLengthSeconds: number,
  bayesian: BayesianResult,
  hmm: HMMResult,
  particle: ParticleResult,
  kalman: KalmanResult,
): TrafficLightEstimate["phaseOffsetDistribution"] {
  const bayesianPeaks = bayesian.posterior
    .map((confidence, offsetSeconds) => ({ offsetSeconds, confidence, source: "Bayesian posterior" }))
    .sort((a, b) => b.confidence - a.confidence)
    .filter((candidate, index, sorted) =>
      index < 18 && sorted.findIndex((other) => circularDistance(other.offsetSeconds, candidate.offsetSeconds, cycleLengthSeconds) <= 2) === index,
    )
    .slice(0, 4);

  return [
    ...bayesianPeaks,
    {
      offsetSeconds: hmm.window.start,
      confidence: hmm.confidence,
      source: "HMM green window",
    },
    {
      offsetSeconds: particle.offsetSeconds,
      confidence: particle.confidence,
      source: "Particle filter",
    },
    {
      offsetSeconds: kalman.offsetSeconds,
      confidence: kalman.confidence,
      source: "Kalman drift",
    },
  ]
    .map((candidate) => ({
      ...candidate,
      offsetSeconds: modulo(candidate.offsetSeconds, cycleLengthSeconds),
      confidence: Math.max(0, Math.min(1, candidate.confidence)),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 7);
}

function findDominantGreenWindow(
  passes: TrafficLightPass[],
  anchorTimestamp: number,
  cycleLengthSeconds: number,
) {
  const histogram = buildHistogram(passes, anchorTimestamp, cycleLengthSeconds);
  const scoreByBin = histogram.green.map((greenValue, index) => greenValue - histogram.red[index]);
  const totalEvidence = histogram.green.map((greenValue, index) => greenValue + histogram.red[index]);
  const activeBins = scoreByBin
    .map((score, index) => ({ score, index, evidence: totalEvidence[index] }))
    .filter((item) => item.evidence > 0.04);

  if (!activeBins.length) {
    const greenShare = passes.filter((pass) => pass.passState === "green").length / Math.max(1, passes.length);
    const greenDurationSeconds = Math.max(24, Math.round(cycleLengthSeconds * Math.max(0.22, Math.min(0.78, greenShare || 0.5))));
    const phaseOffsetSeconds = 0;
    return {
      greenDurationSeconds,
      phaseOffsetSeconds,
      phaseSeparationScore: 0.16,
    };
  }

  const bestGreenRun = (() => {
    const sorted = activeBins.slice().sort((a, b) => a.index - b.index);
    const doubled = [...sorted, ...sorted.map((item) => ({ ...item, index: item.index + cycleLengthSeconds }))];
    let bestStart = sorted[0].index;
    let bestLength = 0;
    let bestScore = -Infinity;

    for (let start = 0; start < sorted.length; start += 1) {
      let end = start;
      let accumulatedScore = 0;
      while (
        end + 1 < doubled.length &&
        doubled[end + 1].index - doubled[end].index <= 2 &&
        doubled[end + 1].index - doubled[start].index <= cycleLengthSeconds
      ) {
        end += 1;
      }
      const length = doubled[end].index - doubled[start].index + 1;
      for (let cursor = start; cursor <= end; cursor += 1) {
        accumulatedScore += doubled[cursor].score;
      }
      if (accumulatedScore > bestScore) {
        bestScore = accumulatedScore;
        bestStart = doubled[start].index % cycleLengthSeconds;
        bestLength = Math.min(cycleLengthSeconds, length);
      }
    }

    return { bestStart, bestLength, bestScore };
  })();

  const greenDurationSeconds = Math.max(20, Math.round(bestGreenRun.bestLength));
  const phaseOffsetSeconds = modulo(bestGreenRun.bestStart, cycleLengthSeconds);
  const phaseSeparationScore = Math.max(0.12, Math.min(1, bestGreenRun.bestScore / Math.max(1, passes.length * 0.8)));
  return {
    greenDurationSeconds,
    phaseOffsetSeconds,
    phaseSeparationScore,
  };
}

export function estimateTrafficLightPhases(light: TrafficLightLocation, passes: TrafficLightPass[]) {
  const usable = passes.filter((pass) => pass.lightId === light.id && pass.passState !== "unknown");
  const routeCount = new Set(usable.map((pass) => `${pass.routeId}:${pass.directionId ?? ""}`)).size;
  const stopPassCount = usable.filter((pass) => pass.stoppedBeforeLight).length;
  const greenPassCount = usable.filter((pass) => pass.passState === "green").length;
  const redPassCount = usable.filter((pass) => pass.passState === "red").length;
  const greenStartCount = usable.filter((pass) => pass.greenStartTimestamp !== undefined).length;
  const passCount = usable.length;
  const { cycleLengthSeconds, anchorTimestamp, cycleConfidence, distribution: cycleLengthDistribution } = estimateCycleLength(usable);
  const samples = buildPhaseSamples(usable, cycleLengthSeconds, anchorTimestamp);
  const bayesian = estimateBayesianPosterior(samples, cycleLengthSeconds);
  const hmm = estimateHmmWindow(samples, cycleLengthSeconds, bayesian);
  const routeAlignment = estimateRouteAlignment(samples, cycleLengthSeconds, hmm.window);
  const particle = estimateParticlePosterior(samples, cycleLengthSeconds, hmm.window, routeAlignment.routeConsensusOffset);
  const kalman = estimateKalmanDrift(samples, cycleLengthSeconds, particle.offsetSeconds);
  const phaseOffsetSeconds = circularMean(
    [hmm.window.start, bayesian.bestBin, particle.offsetSeconds, kalman.offsetSeconds],
    cycleLengthSeconds,
  );
  const kalmanAdjustedOffset = modulo(
    phaseOffsetSeconds + kalman.driftSecondsPerHour * ((Date.now() / 1000 - anchorTimestamp) / 3600),
    cycleLengthSeconds,
  );
  const greenDurationSeconds = Math.max(
    20,
    Math.min(
      cycleLengthSeconds - 8,
      Math.round(
        hmm.window.duration *
          (0.84 + bayesian.confidence * 0.08 + routeAlignment.alignmentScore * 0.08),
      ),
    ),
  );
  const redDurationSeconds = Math.max(8, cycleLengthSeconds - greenDurationSeconds);
  const currentPhaseSeconds = modulo(Date.now() / 1000 - anchorTimestamp, cycleLengthSeconds);
  const withinGreen = isPhaseWithinWindow(
    currentPhaseSeconds,
    kalmanAdjustedOffset,
    greenDurationSeconds,
    cycleLengthSeconds,
  );
  const currentState: TrafficPhaseState = usable.length >= 2 ? (withinGreen ? "green" : "red") : "unknown";
  const timeUntilTransitionSeconds = phaseDistanceToWindowEnd(
    currentPhaseSeconds,
    kalmanAdjustedOffset,
    greenDurationSeconds,
    cycleLengthSeconds,
  );
  const greenShare = greenPassCount / Math.max(1, greenPassCount + redPassCount);
  const hasStateContrast = greenPassCount > 0 && redPassCount > 0;
  const evidenceScore = Math.min(1, usable.length / 16);
  const routeScore = Math.min(1, routeCount / 3);
  const stopScore = Math.min(1, stopPassCount / 5);
  const offsetSpread = Math.max(1, particle.spreadSeconds);
  const methodOffsets = [bayesian.bestBin, hmm.window.start, particle.offsetSeconds, kalman.offsetSeconds];
  const meanOffset = circularMean(methodOffsets, cycleLengthSeconds);
  const methodAgreementScore = Math.max(
    0.08,
    Math.min(
      1,
      1 -
        methodOffsets.reduce(
          (sum, offset) => sum + circularDistance(offset, meanOffset, cycleLengthSeconds) / cycleLengthSeconds,
          0,
        ) / Math.max(1, methodOffsets.length),
    ),
  );
  const dailyProfile = buildDailyProfile(samples, cycleLengthSeconds, greenDurationSeconds, kalmanAdjustedOffset);
  const phaseOffsetDistribution = buildPhaseOffsetDistribution(cycleLengthSeconds, bayesian, hmm, particle, kalman);
  const posteriorQuality =
    cycleConfidence * 0.22 +
    bayesian.confidence * 0.22 +
    hmm.confidence * 0.2 +
    routeAlignment.alignmentScore * 0.12 +
    particle.confidence * 0.08 +
    kalman.confidence * 0.06 +
    methodAgreementScore * 0.1;
  const consensusStrength = Math.max(
    0.1,
    Math.min(
      1,
      cycleConfidence * 0.28 +
        routeAlignment.alignmentScore * 0.28 +
        methodAgreementScore * 0.24 +
        Math.min(1, greenStartCount / Math.max(4, passCount * 0.16)) * 0.2,
    ),
  );
  const rawConfidence = Math.max(
    0.1,
    Math.min(
      0.98,
      0.12 +
        evidenceScore * 0.12 +
        routeScore * 0.08 +
        posteriorQuality * 0.52 +
        dailyProfile.temporalStabilityScore * 0.04 +
        stopScore * 0.08 +
        consensusStrength * 0.06 +
        (hasStateContrast ? 0.08 : 0) -
        Math.min(0.12, offsetSpread / Math.max(12, cycleLengthSeconds * 0.24)) +
        (hasStateContrast ? Math.abs(greenShare - 0.5) * 0.02 : 0),
    ),
  );
  const strongConsensus =
    passCount >= 24 &&
    routeCount >= 3 &&
    greenStartCount >= 8 &&
    cycleConfidence >= 0.6 &&
    methodAgreementScore >= 0.8;
  const solidConsensus =
    passCount >= 12 &&
    routeCount >= 2 &&
    greenStartCount >= 4 &&
    cycleConfidence >= 0.4 &&
    methodAgreementScore >= 0.7;
  const confidenceCap = hasStateContrast
    ? strongConsensus
      ? 0.94
      : solidConsensus
        ? 0.88
        : greenStartCount >= 3 && cycleConfidence >= 0.32 && (bayesian.confidence >= 0.22 || methodAgreementScore >= 0.75)
          ? 0.82
          : 0.76
    : greenStartCount > 0
      ? 0.6
      : 0.42;
  const confidence = Math.min(rawConfidence, confidenceCap);

  return {
    lightId: light.id,
    cycleLengthSeconds,
    greenDurationSeconds,
    redDurationSeconds,
    phaseOffsetSeconds: kalmanAdjustedOffset,
    offsetDriftSecondsPerHour: kalman.driftSecondsPerHour,
    anchorTimestamp,
    currentState,
    timeUntilTransitionSeconds,
    confidence,
    bayesianConfidence: bayesian.confidence,
    hmmConfidence: hmm.confidence,
    dtwAlignmentScore: routeAlignment.alignmentScore,
    particleSpreadSeconds: particle.spreadSeconds,
    kalmanConfidence: kalman.confidence,
    methodAgreementScore,
    temporalStabilityScore: dailyProfile.temporalStabilityScore,
    hourlyProfile: dailyProfile.hourlyProfile,
    passCount: usable.length,
    routeCount,
    greenPassCount,
    redPassCount,
    stopPassCount,
    greenStartCount,
    cycleConfidence,
    phaseSeparationScore: Math.max(hmm.confidence, bayesian.confidence, routeAlignment.alignmentScore),
    cycleLengthDistribution,
    phaseOffsetDistribution,
    neighborSupportCount: 0,
    syncAdjustmentSeconds: 0,
  } satisfies Omit<TrafficLightEstimate, "explanation" | "evidenceSummary" | "pipelineStages">;
}

function syncOffsetDifference(reference: number, candidate: number, cycleLengthSeconds: number) {
  const delta = modulo(candidate - reference + cycleLengthSeconds / 2, cycleLengthSeconds) - cycleLengthSeconds / 2;
  return delta;
}

function hasReliableSyncSupport(
  estimate: Omit<TrafficLightEstimate, "explanation" | "evidenceSummary" | "pipelineStages">,
) {
  return (
    estimate.passCount >= 4 &&
    estimate.greenStartCount >= 2 &&
    estimate.greenPassCount > 0 &&
    estimate.redPassCount > 0 &&
    estimate.confidence >= 0.42 &&
    (estimate.methodAgreementScore ?? 0) >= 0.35
  );
}

export function synchronizeNeighborOffsets(
  estimates: Array<Omit<TrafficLightEstimate, "explanation" | "evidenceSummary" | "pipelineStages">>,
  lights: TrafficLightLocation[],
) {
  return estimates.map((estimate) => {
    const currentLight = lights.find((light) => light.id === estimate.lightId);
    if (!currentLight) {
      return estimate;
    }

    if (!hasReliableSyncSupport(estimate)) {
      return {
        ...estimate,
        neighborSupportCount: 0,
        syncAdjustmentSeconds: 0,
      };
    }

    const neighbors = estimates.filter((other) => {
      if (other.lightId === estimate.lightId) return false;
      if (!hasReliableSyncSupport(other)) return false;
      const neighborLight = lights.find((light) => light.id === other.lightId);
      if (!neighborLight) return false;
      const latMeters = (currentLight.lat - neighborLight.lat) * 111_320;
      const lngMeters =
        (currentLight.lng - neighborLight.lng) *
        111_320 *
        Math.cos((currentLight.lat * Math.PI) / 180);
      const distance = Math.hypot(latMeters, lngMeters);
      return distance < 150 && Math.abs(other.cycleLengthSeconds - estimate.cycleLengthSeconds) < 12;
    });

    if (!neighbors.length) {
      return {
        ...estimate,
        neighborSupportCount: 0,
        syncAdjustmentSeconds: 0,
      };
    }

    const cycle = estimate.cycleLengthSeconds;
    const adjustment = neighbors.reduce((total, neighbor) => {
      const delta = syncOffsetDifference(estimate.phaseOffsetSeconds, neighbor.phaseOffsetSeconds, cycle);
      const weight = Math.max(0.12, Math.min(1, neighbor.confidence));
      return total + delta * weight;
    }, 0) / neighbors.reduce((total, neighbor) => total + Math.max(0.12, Math.min(1, neighbor.confidence)), 0);

    const syncedOffset = modulo(estimate.phaseOffsetSeconds + adjustment * 0.28, cycle);
    const currentPhaseSeconds = modulo(Date.now() / 1000 - estimate.anchorTimestamp, cycle);
    const withinGreen = isPhaseWithinWindow(currentPhaseSeconds, syncedOffset, estimate.greenDurationSeconds, cycle);
    const currentState: TrafficPhaseState = estimate.passCount >= 2 ? (withinGreen ? "green" : "red") : "unknown";
    return {
      ...estimate,
      phaseOffsetSeconds: syncedOffset,
      currentState,
      timeUntilTransitionSeconds: phaseDistanceToWindowEnd(
        currentPhaseSeconds,
        syncedOffset,
        estimate.greenDurationSeconds,
        cycle,
      ),
      neighborSupportCount: neighbors.length,
      syncAdjustmentSeconds: adjustment * 0.28,
    };
  });
}

export function finalizeTrafficLightEstimate(
  light: TrafficLightLocation,
  estimate: Omit<TrafficLightEstimate, "explanation" | "evidenceSummary" | "pipelineStages">,
): TrafficLightEstimate {
  const methodScorePieces = [
    `Bayes ${Math.round((estimate.bayesianConfidence ?? estimate.confidence) * 100)}%`,
    `HMM ${Math.round((estimate.hmmConfidence ?? estimate.confidence) * 100)}%`,
    `DTW ${Math.round((estimate.dtwAlignmentScore ?? estimate.confidence) * 100)}%`,
    `Particle spread ${Math.round(estimate.particleSpreadSeconds ?? 0)}s`,
    `Kalman ${Math.round((estimate.kalmanConfidence ?? estimate.confidence) * 100)}%`,
  ];
  return {
    ...estimate,
    explanation:
      "The estimator starts with GPS proximity and stop detection, then refines the phase with Bayesian phase inference, an HMM window model, DTW route alignment, a particle filter for live offset tracking, and a Kalman-style drift correction. Confidence is now a posterior-style agreement score, so it rises when the methods converge and stays low when the data disagree.",
    evidenceSummary: [
      `${estimate.passCount} usable passes`,
      `${estimate.routeCount} distinct route and direction combinations`,
      `${estimate.stopPassCount} upstream stop events`,
      `${estimate.greenStartCount} detected green-start markers`,
      `${Math.round(estimate.confidence * 100)}% posterior confidence`,
    ],
    pipelineStages: [
      {
        id: "map-match",
        title: "1. Map-match vehicle traces",
        detail: `Observations are grouped by route and vehicle, then filtered to the ${light.name} corridor.`,
        done: estimate.passCount > 0,
      },
      {
        id: "approach",
        title: "2. Detect approaches",
        detail: "Each pass keeps the nearest approach vector and the closest sampled point to the light.",
        done: estimate.passCount >= 2,
      },
      {
        id: "stop",
        title: "3. Detect stops before lights",
        detail: "Low-speed clusters longer than eight seconds become stop candidates, unless they align with a known bus stop.",
        done: estimate.stopPassCount > 0,
      },
      {
        id: "classify",
        title: "4. Classify pass as green/red",
        detail: "Stops upstream of the stop line become red passes; passes that cross without a stop cluster stay green.",
        done: estimate.greenPassCount > 0 && estimate.redPassCount > 0,
      },
      {
        id: "cycle",
        title: "5. Estimate cycle length",
        detail: `A circular period search picks the strongest repeat interval, currently ${estimate.cycleLengthSeconds}s.`,
        done: estimate.cycleConfidence >= 0.25,
      },
      {
        id: "phase",
        title: "6. Estimate phase windows",
        detail: `Bayesian and HMM phase posteriors agree on a green window of ${estimate.greenDurationSeconds}s and a red window of ${estimate.redDurationSeconds}s.`,
        done: Math.max(estimate.phaseSeparationScore, estimate.methodAgreementScore ?? 0) >= 0.2,
      },
      {
        id: "sync",
        title: "7. Synchronize neighboring lights",
        detail: estimate.neighborSupportCount
          ? `Nearby lights contributed ${estimate.neighborSupportCount} synchronized peers and a ${estimate.syncAdjustmentSeconds.toFixed(1)}s offset correction.`
          : "Nearby lights are not yet strong enough to shift the phase estimate.",
        done: estimate.neighborSupportCount > 0,
      },
      {
        id: "live",
        title: "8. Update the live estimate",
        detail: `The current state is ${estimate.currentState}, with ${estimate.timeUntilTransitionSeconds.toFixed(0)}s until the next transition and ${Math.round((estimate.offsetDriftSecondsPerHour ?? 0) * 10) / 10}s/h drift.`,
        done: estimate.confidence >= 0.3,
      },
      {
        id: "stack",
        title: "Better stack: Bayesian, HMM, DTW, particle, Kalman",
        detail: methodScorePieces.join(" · "),
        done: (estimate.bayesianConfidence ?? 0) > 0 && (estimate.hmmConfidence ?? 0) > 0,
      },
      {
        id: "daily",
        title: "9. Build a 24-hour distribution",
        detail: `Hourly posteriors show how the signal behaves across the day; temporal stability is ${Math.round((estimate.temporalStabilityScore ?? 0) * 100)}%.`,
        done: (estimate.hourlyProfile?.some((slice) => slice.sampleCount > 0) ?? false),
      },
    ],
  };
}

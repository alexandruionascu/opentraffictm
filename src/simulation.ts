import type { Actor, Coordinate, Scenario, SignalProgram, SignalState } from "./data";

export interface ActorFrame {
  id: string;
  type: Actor["type"];
  label: string;
  position: Coordinate;
  headingDeg: number;
  progress: number;
  waiting: boolean;
  speedMps: number;
  queueIndex: number;
  laneIndex: number;
  laneOffsetMeters: number;
  congestion: number;
  stoppedFor?: string;
}

export interface SignalFrame {
  id: string;
  name: string;
  position: Coordinate;
  state: SignalState;
  primaryHeadingDeg?: number;
  secondsRemaining: number;
  cycleSeconds: number;
  phaseIndex: number;
}

export interface SignalComparisonFrame {
  id: string;
  name: string;
  state: SignalState;
  secondsRemaining: number;
  cycleSeconds: number;
  blockedActors: number;
  queueMeters: number;
  estimatedDelaySeconds: number;
}

export interface SimulationFrame {
  timeSeconds: number;
  actors: ActorFrame[];
  signals: SignalFrame[];
  signalComparisons: SignalComparisonFrame[];
  metrics: {
    activeActors: number;
    averageProgress: number;
    waitingActors: number;
    throughput: number;
    averageSpeedKmh: number;
    queueLength: number;
    signalPressure: number;
  };
}

const metersPerDegreeLat = 111_320;

function metersPerDegreeLng(lat: number) {
  return Math.cos((lat * Math.PI) / 180) * metersPerDegreeLat;
}

function distanceMeters(a: Coordinate, b: Coordinate) {
  const x = (b.lng - a.lng) * metersPerDegreeLng((a.lat + b.lat) / 2);
  const y = (b.lat - a.lat) * metersPerDegreeLat;
  return Math.sqrt(x * x + y * y);
}

function heading(a: Coordinate, b: Coordinate) {
  const x = (b.lng - a.lng) * metersPerDegreeLng((a.lat + b.lat) / 2);
  const y = (b.lat - a.lat) * metersPerDegreeLat;
  return (Math.atan2(x, y) * 180) / Math.PI;
}

function interpolate(a: Coordinate, b: Coordinate, ratio: number): Coordinate {
  return {
    lng: a.lng + (b.lng - a.lng) * ratio,
    lat: a.lat + (b.lat - a.lat) * ratio,
  };
}

interface RouteInfo {
  length: number;
  closed: boolean;
  segments: Array<{ start: Coordinate; end: Coordinate; startDistance: number; length: number }>;
}

const routeInfoCache = new WeakMap<Coordinate[], RouteInfo>();
const laneAssignmentsCache = new WeakMap<
  Actor[],
  Map<string, { laneIndex: number; laneOffsetMeters: number; laneKey: string }>
>();

function getRouteInfo(route: Coordinate[]) {
  const cached = routeInfoCache.get(route);
  if (cached) return cached;

  const segments: RouteInfo["segments"] = [];
  let length = 0;

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const segmentLength = distanceMeters(start, end);
    segments.push({ start, end, startDistance: length, length: segmentLength });
    length += segmentLength;
  }

  const first = route[0];
  const last = route.at(-1);
  const closed = Boolean(first && last && distanceMeters(first, last) < 25);
  const info = { length, closed, segments };
  routeInfoCache.set(route, info);
  return info;
}

function routeLength(route: Coordinate[]) {
  return getRouteInfo(route).length;
}

function routeIsClosed(route: Coordinate[]) {
  return getRouteInfo(route).closed;
}

function routeSegments(route: Coordinate[]) {
  return getRouteInfo(route).segments;
}

function pointOnRoute(route: Coordinate[], distance: number) {
  const info = getRouteInfo(route);
  let remaining = distance;

  for (let index = 0; index < info.segments.length; index += 1) {
    const segment = info.segments[index];
    const { start, end, length: segmentLength } = segment;

    if (remaining <= segmentLength) {
      const ratio = segmentLength === 0 ? 0 : remaining / segmentLength;
      return {
        position: interpolate(start, end, ratio),
        headingDeg: heading(start, end),
        segmentIndex: index - 1,
        segmentStart: start,
        segmentEnd: end,
      };
    }

    remaining -= segmentLength;
  }

  const last = route[route.length - 1];
  const beforeLast = route[route.length - 2] ?? last;
  return {
    position: last,
    headingDeg: heading(beforeLast, last),
    segmentIndex: Math.max(0, route.length - 2),
    segmentStart: beforeLast,
    segmentEnd: last,
  };
}

function routeCyclePosition(distance: number, length: number, closed = false) {
  if (length <= 0) {
    return { distance: 0, returning: false, progress: 0 };
  }

  if (closed) {
    const routeDistance = ((distance % length) + length) % length;
    return {
      distance: routeDistance,
      returning: false,
      progress: routeDistance / length,
    };
  }

  const cycleLength = length * 2;
  const cycleDistance = ((distance % cycleLength) + cycleLength) % cycleLength;
  const returning = cycleDistance > length;
  const routeDistance = returning ? cycleLength - cycleDistance : cycleDistance;

  return {
    distance: routeDistance,
    returning,
    progress: routeDistance / length,
  };
}

function pointOnTravelRoute(route: Coordinate[], distance: number, length = routeLength(route)) {
  const cycle = routeCyclePosition(distance, length, routeIsClosed(route));
  const point = pointOnRoute(route, cycle.distance);

  if (!cycle.returning) {
    return {
      ...point,
      progress: cycle.progress,
      returning: false,
    };
  }

  return {
    ...point,
    headingDeg: (point.headingDeg + 180) % 360,
    segmentStart: point.segmentEnd,
    segmentEnd: point.segmentStart,
    progress: cycle.progress,
    returning: true,
  };
}

function offsetCoordinate(point: Coordinate, headingDeg: number, offsetMeters: number): Coordinate {
  if (offsetMeters === 0) return point;

  const headingRad = (headingDeg * Math.PI) / 180;
  const lngScale = metersPerDegreeLng(point.lat);
  const eastMeters = Math.cos(headingRad) * offsetMeters;
  const northMeters = -Math.sin(headingRad) * offsetMeters;

  return {
    lng: point.lng + eastMeters / lngScale,
    lat: point.lat + northMeters / metersPerDegreeLat,
  };
}

function routeKey(route: Coordinate[]) {
  return route.map((point) => `${point.lng.toFixed(5)},${point.lat.toFixed(5)}`).join("|");
}

function angularDifference(a: number, b: number) {
  const diff = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return diff;
}

function axisDifference(a: number, b: number) {
  return Math.min(angularDifference(a, b), angularDifference(a, b + 180));
}

function segmentKey(start: Coordinate, end: Coordinate, laneIndex: number) {
  return [
    start.lng.toFixed(4),
    start.lat.toFixed(4),
    end.lng.toFixed(4),
    end.lat.toFixed(4),
    `lane-${laneIndex}`,
  ].join(":");
}

function turnBiasMeters(route: Coordinate[], distance: number) {
  const length = routeLength(route);
  const here = pointOnTravelRoute(route, distance, length);
  const ahead = pointOnTravelRoute(route, distance + 42, length);
  const turnDelta = (((ahead.headingDeg - here.headingDeg) % 360) + 540) % 360 - 180;

  if (Math.abs(turnDelta) < 24) return 0;
  return turnDelta > 0 ? 1.7 : -1.7;
}

function laneAssignments(actors: Actor[]) {
  const cached = laneAssignmentsCache.get(actors);
  if (cached) return cached;

  const nextLaneByRoute = new Map<string, number>();
  const lanes = new Map<string, { laneIndex: number; laneOffsetMeters: number; laneKey: string }>();

  for (const actor of actors) {
    if (actor.type === "pedestrian") {
      lanes.set(actor.id, { laneIndex: 0, laneOffsetMeters: 0, laneKey: `${actor.id}:walk` });
      continue;
    }

    const key = routeKey(actor.route);
    const laneIndex = nextLaneByRoute.get(key) ?? 0;
    nextLaneByRoute.set(key, (laneIndex + 1) % 2);
    lanes.set(actor.id, {
      laneIndex,
      laneOffsetMeters: 2.2 + laneIndex * 4.1,
      laneKey: `${key}:lane-${laneIndex}`,
    });
  }

  laneAssignmentsCache.set(actors, lanes);
  return lanes;
}

function closestDistanceOnSegment(point: Coordinate, start: Coordinate, end: Coordinate) {
  const originLngScale = metersPerDegreeLng(point.lat);
  const ax = (start.lng - point.lng) * originLngScale;
  const ay = (start.lat - point.lat) * metersPerDegreeLat;
  const bx = (end.lng - point.lng) * originLngScale;
  const by = (end.lat - point.lat) * metersPerDegreeLat;
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * vx + ay * vy) / lengthSquared));
  const closestX = ax + vx * t;
  const closestY = ay + vy * t;

  return {
    distanceMeters: Math.sqrt(closestX * closestX + closestY * closestY),
    segmentRatio: t,
  };
}

function distanceAlongRouteNear(route: Coordinate[], target: Coordinate) {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAlongRoute = 0;

  for (const segment of routeSegments(route)) {
    const candidate = closestDistanceOnSegment(target, segment.start, segment.end);
    if (candidate.distanceMeters < bestDistance) {
      bestDistance = candidate.distanceMeters;
      bestAlongRoute = segment.startDistance + candidate.segmentRatio * segment.length;
    }
  }

  return { routeDistance: bestAlongRoute, lateralDistance: bestDistance };
}

function signalAt(program: SignalProgram, timeSeconds: number): SignalFrame {
  const cycle = program.phases.reduce((total, phase) => total + phase.durationSeconds, 0);
  let phaseClock = (timeSeconds + program.offsetSeconds) % cycle;
  let phaseIndex = 0;

  for (const [index, phase] of program.phases.entries()) {
    if (phaseClock < phase.durationSeconds) {
      return {
        id: program.id,
        name: program.name,
        position: program.position,
        state: phase.state,
        primaryHeadingDeg: program.primaryHeadingDeg,
        secondsRemaining: Math.ceil(phase.durationSeconds - phaseClock),
        cycleSeconds: cycle,
        phaseIndex: index,
      };
    }
    phaseClock -= phase.durationSeconds;
    phaseIndex = index + 1;
  }

  return {
    id: program.id,
    name: program.name,
    position: program.position,
    state: "red",
    primaryHeadingDeg: program.primaryHeadingDeg,
    secondsRemaining: 0,
    cycleSeconds: cycle,
    phaseIndex,
  };
}

function stopLineOffsetMeters(actor: Actor) {
  if (actor.type === "bus") return 9.5;
  if (actor.type === "pedestrian") return 1.4;
  return 6.4;
}

function signalAllowsActor(actor: Actor, signal: SignalFrame, routeDistance: number) {
  if (actor.type === "pedestrian") {
    return signal.state === "red";
  }

  if (signal.primaryHeadingDeg === undefined) {
    return signal.state === "green";
  }

  const approachHeading = pointOnRoute(actor.route, routeDistance).headingDeg;
  const isPrimaryApproach = axisDifference(approachHeading, signal.primaryHeadingDeg) <= 42;

  if (isPrimaryApproach) {
    return signal.state === "green";
  }

  return signal.state === "red";
}

function blockingSignalsOnRoute(actor: Actor, routeLengthMeters: number, signals: SignalFrame[]) {
  const blockers: Array<{ signal: SignalFrame; stopDistance: number }> = [];

  for (const signal of signals) {
    const projection = distanceAlongRouteNear(actor.route, signal.position);

    if (projection.lateralDistance > 45 || signalAllowsActor(actor, signal, projection.routeDistance)) {
      continue;
    }

    const stopDistance =
      actor.type === "pedestrian"
        ? projection.routeDistance - stopLineOffsetMeters(actor)
        : projection.routeDistance - Math.max(actor.lengthMeters ?? 4.8, 4.8) - stopLineOffsetMeters(actor);
    blockers.push({ signal, stopDistance: Math.max(0, Math.min(stopDistance, routeLengthMeters)) });
  }

  return blockers;
}

function nextBlockingSignal(
  actor: Actor,
  distance: number,
  travelDistance: number,
  length: number,
  signals: SignalFrame[],
) {
  let best: { signal: SignalFrame; stopDistance: number; distanceAhead: number } | undefined;

  for (const blocker of blockingSignalsOnRoute(actor, length, signals)) {
    const distanceAhead =
      blocker.stopDistance >= distance ? blocker.stopDistance - distance : length - distance + blocker.stopDistance;
    const lookAhead = actor.type === "pedestrian" ? 3 : Math.max(actor.lengthMeters ?? 4.8, 4.8);

    if (distanceAhead <= travelDistance + lookAhead && (!best || distanceAhead < best.distanceAhead)) {
      best = { ...blocker, distanceAhead };
    }
  }

  return best;
}

export function simulateScenario(scenario: Scenario, timeSeconds: number): SimulationFrame {
  const warmupSeconds = 18;
  const simulationStart = Math.max(0, timeSeconds - warmupSeconds);
  const signals = scenario.signals.map((program) => signalAt(program, timeSeconds));
  const lanes = laneAssignments(scenario.actors);
  const actorLookup = new Map(scenario.actors.map((actor) => [actor.id, actor] as const));
  const states = scenario.actors.map((actor) => {
    const length = routeLength(actor.route);
    const routeCycleLength = routeIsClosed(actor.route) ? length : length * 2;
    const phaseDistance =
      routeCycleLength > 0
        ? (((actor.routeOffsetSeconds ?? 0) + simulationStart) * actor.speedMps) % routeCycleLength
        : 0;

    return {
      actor,
      length,
      distance: phaseDistance,
      speedMps: actor.type === "pedestrian" ? actor.speedMps : actor.speedMps * 0.72,
      waiting: false,
      queueIndex: -1,
      congestion: 0,
      stoppedFor: undefined as string | undefined,
    };
  });
  const stateById = new Map(states.map((state) => [state.actor.id, state] as const));
  const stepSeconds = 0.5;

  for (let simTime = simulationStart; simTime < timeSeconds; simTime += stepSeconds) {
    const step = Math.min(stepSeconds, timeSeconds - simTime);
    const stepSignals = scenario.signals.map((program) => signalAt(program, simTime + step));
    const candidates = states.map((state) => {
      const { actor, length } = state;
      const dwellDistance = actor.type === "bus" ? length * 0.48 : undefined;
      const dwellSeconds = actor.dwellSeconds ?? 0;
      const dwellStartTime =
        dwellDistance && actor.speedMps > 0 ? dwellDistance / actor.speedMps : -1;
      const dwelling =
        actor.type === "bus" &&
        dwellDistance !== undefined &&
        simTime + step >= dwellStartTime &&
        simTime + step <= dwellStartTime + dwellSeconds &&
        Math.abs(state.distance - dwellDistance) < 35;
      const targetSpeed = !dwelling ? actor.speedMps : 0;
      const acceleration = actor.type === "bus" ? 1.15 : actor.type === "pedestrian" ? 0.55 : 1.9;
      const nextSpeed =
        targetSpeed > state.speedMps
          ? Math.min(targetSpeed, state.speedMps + acceleration * step)
          : Math.max(targetSpeed, state.speedMps - acceleration * 2.4 * step);
      const desiredAdvance = nextSpeed * step;
      const routeClosed = routeIsClosed(actor.route);
      const travelPosition = routeCyclePosition(state.distance, length, routeClosed);
      const signalBlocker = nextBlockingSignal(
        actor,
        travelPosition.distance,
        desiredAdvance + Math.max(16, state.speedMps * 3.4),
        length,
        stepSignals,
      );
      let nextDistance = length <= 0 ? 0 : state.distance + desiredAdvance;
      let stoppedFor: string | undefined;
      let speedMps = nextSpeed;

      if (dwelling && dwellDistance !== undefined) {
        nextDistance = dwellDistance;
        speedMps = 0;
        stoppedFor = "bus stop dwell";
      } else if (
        !travelPosition.returning &&
        signalBlocker &&
        signalBlocker.distanceAhead <= desiredAdvance + Math.max(actor.lengthMeters ?? 4.8, 4.8)
      ) {
        nextDistance = signalBlocker.stopDistance;
        speedMps = 0;
        stoppedFor = signalBlocker.signal.name;
      } else if (length > 0) {
        const routeCycleLength = routeClosed ? length : length * 2;
        if (nextDistance >= routeCycleLength) {
          nextDistance %= routeCycleLength;
        }
      }

      return {
        ...state,
        nextDistance,
        speedMps,
        waiting: Boolean(stoppedFor),
        queueIndex: stoppedFor ? 0 : -1,
        congestion: 0,
        stoppedFor,
      };
    });

    const byLane = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      const lane = lanes.get(candidate.actor.id);
      const point = pointOnTravelRoute(candidate.actor.route, candidate.distance, candidate.length);
      const laneKey =
        candidate.actor.type === "pedestrian"
          ? lane?.laneKey ?? candidate.actor.id
          : segmentKey(point.segmentStart, point.segmentEnd, lane?.laneIndex ?? 0);
      byLane.set(laneKey, [...(byLane.get(laneKey) ?? []), candidate]);
    }

    for (const laneCandidates of byLane.values()) {
      laneCandidates.sort((a, b) => b.distance - a.distance);
      let leader: (typeof laneCandidates)[number] | undefined;

      for (const candidate of laneCandidates) {
        if (leader && leader.nextDistance >= leader.distance && candidate.distance <= leader.distance) {
          const gap = Math.max(candidate.actor.lengthMeters ?? 4.8, 4.8) + 2.8;
          const maxDistance = Math.max(0, leader.nextDistance - gap);

          if (candidate.nextDistance > maxDistance) {
            candidate.nextDistance = maxDistance;
            candidate.speedMps = 0;
            candidate.waiting = true;
            candidate.stoppedFor = leader.stoppedFor ?? "traffic ahead";
            candidate.queueIndex = leader.queueIndex >= 0 ? leader.queueIndex + 1 : 0;
            candidate.congestion = Math.max(candidate.congestion, Math.min(1, candidate.queueIndex / 6));
          }
        }

        leader = candidate;
      }
    }

    for (const signal of stepSignals) {
      const vehiclesInJunction = candidates
        .filter((candidate) => {
          if (candidate.actor.type === "pedestrian" || candidate.speedMps <= 0) return false;
          const point = pointOnTravelRoute(candidate.actor.route, candidate.nextDistance, candidate.length);
          return distanceMeters(point.position, signal.position) < 28;
        })
        .sort((a, b) => {
          const aPrimary = signal.primaryHeadingDeg
            ? axisDifference(pointOnTravelRoute(a.actor.route, a.nextDistance, a.length).headingDeg, signal.primaryHeadingDeg)
            : 0;
          const bPrimary = signal.primaryHeadingDeg
            ? axisDifference(pointOnTravelRoute(b.actor.route, b.nextDistance, b.length).headingDeg, signal.primaryHeadingDeg)
            : 0;
          return aPrimary - bPrimary || b.speedMps - a.speedMps;
        });

      for (let index = 1; index < vehiclesInJunction.length; index += 1) {
        const candidate = vehiclesInJunction[index];
        candidate.nextDistance = Math.max(0, candidate.distance - 1);
        candidate.speedMps = 0;
        candidate.waiting = true;
        candidate.stoppedFor = "intersection yield";
        candidate.queueIndex = Math.max(candidate.queueIndex, index);
        candidate.congestion = Math.max(candidate.congestion, 0.55);
      }
    }

    for (const candidate of candidates) {
      candidate.distance = candidate.nextDistance;
      const state = stateById.get(candidate.actor.id);
      if (!state) continue;
      state.distance = candidate.nextDistance;
      state.speedMps = candidate.speedMps;
      state.waiting = candidate.waiting;
      state.queueIndex = candidate.queueIndex;
      state.congestion = candidate.congestion;
      state.stoppedFor = candidate.stoppedFor;
    }
  }

  const actors = states.map((state) => {
    const lane = lanes.get(state.actor.id) ?? { laneIndex: 0, laneOffsetMeters: 0 };
    const point = pointOnTravelRoute(state.actor.route, state.distance, state.length);
    const dynamicLaneOffset =
      lane.laneOffsetMeters +
      (state.actor.type === "car" ? turnBiasMeters(state.actor.route, state.distance) : 0);
    const position = offsetCoordinate(point.position, point.headingDeg, dynamicLaneOffset);

    return {
      id: state.actor.id,
      type: state.actor.type,
      label: state.actor.label,
      position,
      headingDeg: point.headingDeg,
      progress: point.progress,
      waiting: state.waiting,
      speedMps: state.speedMps,
      queueIndex: state.queueIndex,
      laneIndex: lane.laneIndex,
      laneOffsetMeters: dynamicLaneOffset,
      congestion: state.congestion,
      stoppedFor: state.stoppedFor,
    };
  });

  const signalComparisons = signals.map((signal) => {
    const blockedActors = actors.filter((actor) => actor.stoppedFor === signal.name || actor.stoppedFor === signal.id);
    const queueMeters = blockedActors.reduce((total, actor) => {
      const original = actorLookup.get(actor.id);
      return total + Math.max(original?.lengthMeters ?? 4.8, 4.8) + 2.8;
    }, 0);
    const estimatedDelaySeconds = blockedActors.reduce((total, actor) => {
      const original = actorLookup.get(actor.id);
      const delayFactor = original?.type === "bus" ? 1.8 : original?.type === "pedestrian" ? 0.8 : 1.2;
      return total + delayFactor * (signal.state === "red" ? 6.5 : signal.state === "yellow" ? 3.5 : 1.1);
    }, 0);

    return {
      id: signal.id,
      name: signal.name,
      state: signal.state,
      secondsRemaining: signal.secondsRemaining,
      cycleSeconds: signal.cycleSeconds,
      blockedActors: blockedActors.length,
      queueMeters,
      estimatedDelaySeconds,
    };
  });

  const activeActors = actors.length;
  const averageProgress =
    actors.reduce((total, actor) => total + actor.progress, 0) / Math.max(activeActors, 1);
  const waitingActors = actors.filter((actor) => actor.waiting).length;
  const averageSpeedKmh =
    (actors.reduce((total, actor) => total + actor.speedMps, 0) / Math.max(activeActors, 1)) * 3.6;

  return {
    timeSeconds,
    actors,
    signals,
    metrics: {
      activeActors,
      averageProgress,
      waitingActors,
      queueLength: waitingActors,
      averageSpeedKmh,
      throughput: actors.filter((actor) => actor.progress > 0.92).length,
      signalPressure: signalComparisons.reduce((total, comparison) => total + comparison.blockedActors, 0),
    },
    signalComparisons,
  };
}

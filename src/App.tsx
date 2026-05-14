import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  datasets,
  leaderboards,
  officialSources,
  scenarios,
  technicalPapers,
  type DatasetEntry,
  type OfficialSourceEntry,
  type LeaderboardEntry,
  type Scenario,
} from "./data";
import { downloadJson, type LeaderboardManifest, type ScenarioCatalogManifest } from "./contracts";
import {
  createMockSnapshot,
  createTimisoaraClosuresAdapter,
  createTimisoaraStptAdapter,
  trafficValidationFolderContract,
  type TrafficProvider,
  type TrafficProviderAdapter,
  type ValidationResult,
} from "./traffic-validation";
import { TrafficLightInferenceApp } from "./traffic-light/TrafficLightInferenceApp";
import type {
  TrafficLightIntersectionAnalysis,
  TrafficLightProbeExportManifest,
} from "./contracts";
import { TrafficLightConfidenceMap, type TrafficHistoricalPlace, type TrafficProbeTrack } from "./map/TrafficLightConfidenceMap";

const LiveMap = lazy(() => import("./map/LiveMap").then((module) => ({ default: module.LiveMap })));

const eBusExamples = [
  { route: "E2", label: "E2", places: "Mărăști, Continental, Județean" },
  { route: "E1", label: "E1", places: "Shopping City, Calea Șagului" },
  { route: "E7", label: "E7", places: "east-west express corridor" },
  { route: "E8", label: "E8", places: "south corridor overlaps" },
  { route: "E4b", label: "E4b", places: "mixed express branch" },
];

const navItems = [
  { path: "/", label: "Home" },
  { path: "/map", label: "Live Map" },
  { path: "/datasets", label: "Data" },
  { path: "/sources", label: "Sources" },
  { path: "/validation", label: "Validation" },
  { path: "/traffic-lights", label: "Traffic Lights" },
  { path: "/tomtom", label: "TomTom Traffic" },
  { path: "/sheet", label: "Sheet" },
  { path: "/scenarios", label: "Scenarios" },
  { path: "/leaderboards", label: "Leaderboards" },
  { path: "/papers", label: "Papers" },
];

function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (nextPath: string) => {
    window.history.pushState(null, "", nextPath);
    setPath(nextPath);
  };

  return { path, navigate };
}

function Shell({
  children,
  path,
  navigate,
}: {
  children: ReactNode;
  path: string;
  navigate: (nextPath: string) => void;
}) {
  const isMap = path === "/map" || path === "/traffic-lights";

  return (
    <div className={isMap ? "app app-map" : "app"}>
      <header className={isMap ? "topbar topbar-floating" : "topbar"}>
        <button className="brand" onClick={() => navigate("/")} type="button">
          OpenTrafficTM
        </button>
        <nav>
          {navItems.map((item) => (
            <button
              className={path === item.path ? "active" : ""}
              key={item.path}
              onClick={() => navigate(item.path)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}

export function App() {
  const { path, navigate } = useRoute();

  return (
    <Shell path={path} navigate={navigate}>
      {path === "/map" ? (
        <Suspense fallback={<MapLoading />}>
          <LiveMap scenarios={scenarios} />
        </Suspense>
      ) : null}
      {path === "/datasets" ? <DatasetsPage /> : null}
      {path === "/sources" ? <SourcesPage /> : null}
      {path === "/validation" ? <ValidationPage /> : null}
      {path === "/traffic-lights" ? <TrafficLightInferenceApp /> : null}
      {path === "/tomtom" ? <TomTomTrafficPage /> : null}
      {path === "/sheet" ? <SpreadsheetPage /> : null}
      {path === "/scenarios" ? <ScenariosPage /> : null}
      {path === "/leaderboards" ? <LeaderboardsPage /> : null}
      {path === "/papers" ? <PapersPage /> : null}
      {!["/map", "/datasets", "/sources", "/validation", "/traffic-lights", "/tomtom", "/sheet", "/scenarios", "/leaderboards", "/papers"].includes(path) ? (
        <HomePage />
      ) : null}
    </Shell>
  );
}

const emptyScenario = {
  id: "tomtom-validation",
  name: "TomTom validation corridor",
  district: "Timișoara",
  description: "TomTom live traffic validation snapshot rendered in the shared map shell.",
  boundsLabel: "Timișoara bbox",
  center: { lng: 21.2087, lat: 45.7489 },
  zoom: 12.8,
  durationSeconds: 60,
  actors: [],
  signals: [],
} satisfies Scenario;

function ValidationPage() {
  const adapters = useMemo<Record<TrafficProvider, TrafficProviderAdapter>>(
    () => ({
      google: {
        provider: "google",
        supportsRawCaching: false,
        async fetchSnapshot(request) {
          return createMockSnapshot("google");
        },
      },
      here: {
        provider: "here",
        supportsRawCaching: true,
        async fetchSnapshot(request) {
          return createMockSnapshot("here");
        },
      },
      tomtom: {
        provider: "tomtom",
        supportsRawCaching: true,
        async fetchSnapshot(request) {
          return createMockSnapshot("tomtom");
        },
      },
      "timisoara-stpt": createTimisoaraStptAdapter(),
      "timisoara-closures": createTimisoaraClosuresAdapter(),
    }),
    [],
  );
  const [provider, setProvider] = useState<TrafficProvider>("timisoara-stpt");
  const snapshot = useMemo(
    () =>
      adapters[provider].fetchSnapshot({
        provider,
        requestId: `${provider}-local-validation`,
        requestedAt: new Date().toISOString(),
        windowStart: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        windowEnd: new Date().toISOString(),
        bbox: [21.19, 45.73, 21.24, 45.77],
        corridor: provider === "timisoara-closures" ? "municipal closure overlap" : "city-center corridor",
        mode: provider === "timisoara-stpt" ? "transit-probe" : "traffic",
      }),
    [adapters, provider],
  );
  const [resolvedSnapshot, setResolvedSnapshot] = useState(createMockSnapshot("timisoara-stpt"));
  const [ledgerText, setLedgerText] = useState<string>("Loading quota ledger...");

  useEffect(() => {
    let cancelled = false;
    snapshot.then((nextSnapshot) => {
      if (!cancelled) setResolvedSnapshot(nextSnapshot);
    });
    return () => {
      cancelled = true;
    };
  }, [snapshot]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/data/traffic-validation/usage-ledger-${provider}.json`)
      .then((response) => (response.ok ? response.text() : Promise.resolve("No quota ledger yet.")))
      .then((text) => {
        if (!cancelled) setLedgerText(text);
      })
      .catch(() => {
        if (!cancelled) setLedgerText("No quota ledger yet.");
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const validation = useMemo<ValidationResult>(
    () =>
      ({
        snapshotId: resolvedSnapshot.requestId,
        modelRunId: "browser-native-baseline",
        scenarioId: "city-center-peak",
        provider: resolvedSnapshot.provider,
        requestedAt: resolvedSnapshot.requestedAt,
        accepted: true,
        metrics: [
          {
            name: "speedKph",
            expected: 30,
            observed: resolvedSnapshot.segments[0]?.speedKph ?? 0,
            delta: (resolvedSnapshot.segments[0]?.speedKph ?? 0) / 30 - 1,
          },
          {
            name: "delaySeconds",
            expected: 30,
            observed: resolvedSnapshot.segments[0]?.delaySeconds ?? 0,
            delta: ((resolvedSnapshot.segments[0]?.delaySeconds ?? 0) - 30) / 30,
          },
        ],
        notes: "Local scaffold only. Replace the mock adapter with actual provider fetch logic if needed.",
      }) satisfies ValidationResult,
    [resolvedSnapshot],
  );

  return (
    <main className="page">
      <PageIntro
        eyebrow="Validation"
        title="Private traffic validation stays local."
        text="Use a provider API as a confirmation layer, normalize snapshots locally, and keep only derived results in the app."
      />
      <section className="section-grid">
        <FeatureCard title="Folder contract" text={trafficValidationFolderContract.join("  ")} />
        <FeatureCard title="Google" text="License-gated. Use only if your contract allows the exact caching and validation workflow." />
        <FeatureCard title="HERE / TomTom" text="Adapter-ready for internal validation and local comparison." />
      </section>
      <div className="toolbar">
        <label className="search-input" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          Provider
          <select aria-label="Provider" value={provider} onChange={(event) => setProvider(event.target.value as TrafficProvider)}>
            <option value="here">HERE</option>
            <option value="tomtom">TomTom</option>
            <option value="google">Google</option>
          </select>
        </label>
        <a className="btn secondary" href="/datasets">
          View data folders
        </a>
      </div>
      <section className="card-grid">
        <FeatureCard
          title="Snapshot shape"
          text={`${resolvedSnapshot.provider} snapshot with ${resolvedSnapshot.segments.length} segment(s) and ${resolvedSnapshot.incidents.length} incident(s). Raw stored: ${String(resolvedSnapshot.rawStored)}.`}
        />
        <FeatureCard
          title="Validation output"
          text={`${validation.accepted ? "accepted" : "rejected"} for ${validation.scenarioId} via ${validation.modelRunId}. Metrics: ${validation.metrics.map((metric) => `${metric.name}=${metric.delta}`).join(", ")}.`}
        />
        <FeatureCard title="Quota ledger" text={ledgerText.slice(0, 260)} />
      </section>
      <section className="panel">
        <p className="eyebrow">Implementation contract</p>
        <ol className="clean-list">
          <li>Fetch provider traffic for a bbox or corridor.</li>
          <li>Normalize to `TrafficSnapshot`.</li>
          <li>Store locally only if the license allows it.</li>
          <li>Compare against the current model run.</li>
          <li>Persist `ValidationResult` and derived metrics.</li>
        </ol>
      </section>
    </main>
  );
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
}

function routeMatchesCandidate(candidate: TrafficLightIntersectionAnalysis["candidates"][number], route: string) {
  return candidate.route
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .includes(route.toLowerCase());
}

function historicalPlacesFor(tracks: TrafficProbeTrack[]): TrafficHistoricalPlace[] {
  const groups = new Map<string, Array<{ lng: number; lat: number; waiting: boolean }>>();
  for (const point of tracks.flatMap((track) => track.points)) {
    const stop = point.stop.trim();
    if (!stop || stop.length < 3) continue;
    const bucket = groups.get(stop) ?? [];
    bucket.push({ lng: point.lng, lat: point.lat, waiting: point.speed <= 2.2 });
    groups.set(stop, bucket);
  }

  return [...groups.entries()]
    .map(([name, points]) => ({
      name,
      lng: points.reduce((total, point) => total + point.lng, 0) / points.length,
      lat: points.reduce((total, point) => total + point.lat, 0) / points.length,
      samples: points.length,
      waitingSamples: points.filter((point) => point.waiting).length,
    }))
    .filter((place) => place.samples >= 3)
    .sort((a, b) => b.waitingSamples - a.waitingSamples || b.samples - a.samples)
    .slice(0, 8);
}

function TrafficLightIntersectionPage() {
  const [manifest, setManifest] = useState<TrafficLightProbeExportManifest | null>(null);
  const [analysis, setAnalysis] = useState<TrafficLightIntersectionAnalysis | null>(null);
  const [step, setStep] = useState(0);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState("E2");
  const [tracks, setTracks] = useState<TrafficProbeTrack[]>([]);

  useEffect(() => {
    fetch("/data/traffic-lights/analysis/export-manifest.json")
      .then((response) => response.json())
      .then(setManifest)
      .catch(() => setManifest(null));
    fetch("/data/traffic-lights/analysis/intersection-analysis.json")
      .then((response) => response.json())
      .then(setAnalysis)
      .catch(() => setAnalysis(null));
  }, []);

  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;
    const load = async () => {
      const routeFiles = manifest.files.filter((file) => file.route.toLowerCase() === selectedRoute.toLowerCase());
      const slices = await Promise.all(
        routeFiles.slice(0, 4).map(async (file) => {
          const csv = await fetch(`/data/traffic-lights/analysis/${file.file}`).then((r) => r.text());
          return csv
            .trim()
            .split("\n")
            .slice(1)
            .map((line) => {
              const parts = parseCsvLine(line);
              return {
                vehicleId: parts[0],
                route: parts[1],
                direction: parts[2],
                lng: Number(parts[6]),
                lat: Number(parts[5]),
                speed: Number(parts[8]),
                t: Number(parts[4]),
                stop: parts[10] ?? "",
              };
            })
            .filter((row) => Number.isFinite(row.lng) && Number.isFinite(row.lat));
        }),
      );
      const grouped = new Map<string, Array<{ lng: number; lat: number; t: number; speed: number; stop: string }>>();
      for (const row of slices.flat()) {
        const key = `${row.route}:${row.vehicleId}:${row.direction}`;
        const bucket = grouped.get(key) ?? [];
        bucket.push(row);
        grouped.set(key, bucket);
      }
      const nextTracks = [...grouped.entries()]
        .map(([key, points]) => ({
          id: key,
          route: key.split(":")[0],
          vehicleId: key.split(":")[1],
          points: points
            .sort((a, b) => a.t - b.t)
            .filter((point, index) => index % Math.max(1, Math.floor(points.length / 80)) === 0)
            .map(({ lng, lat, t, speed, stop }) => ({ lng, lat, t, speed, stop })),
        }))
        .filter((item) => item.points.length > 8)
        .sort((a, b) => b.points.length - a.points.length)
        .slice(0, 24);
      if (!cancelled) setTracks(nextTracks);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [manifest, selectedRoute]);

  const best = analysis?.candidates[0];
  const routeCandidates = analysis?.candidates.filter((candidate) => routeMatchesCandidate(candidate, selectedRoute)) ?? [];
  const topCandidates = routeCandidates.length ? routeCandidates : analysis?.candidates.slice(0, 6) ?? [];
  const activeCandidate = analysis?.candidates.find((candidate) => candidate.id === selectedCandidateId) ?? best;
  const activeRouteCandidate = selectedCandidateId
    ? analysis?.candidates.find((candidate) => candidate.id === selectedCandidateId)
    : topCandidates[0];
  const selectedCandidate = activeRouteCandidate ?? activeCandidate;
  const historicalPlaces = useMemo(() => historicalPlacesFor(tracks), [tracks]);

  return (
    <main className="traffic-confidence-page map-page">
      <TrafficLightConfidenceMap tracks={tracks} candidate={selectedCandidate} places={historicalPlaces} step={step} />
      <div className="traffic-map-scrim" />
      <aside className="traffic-wizard traffic-wizard-floating panel">
        <div className="wizard-top">
          <p className="eyebrow">E-bus traffic-light confidence</p>
          <h1>{selectedRoute} historical places to signal confidence</h1>
          <p className="lede">
            Choose an E route, then click each pipeline step. The map does not advance on its own:
            every layer appears only when you ask for it.
          </p>
        </div>

        <div className="route-example-list" aria-label="E bus examples">
          {eBusExamples.map((example) => (
            <button
              className={example.route === selectedRoute ? "route-example active" : "route-example"}
              key={example.route}
              onClick={() => {
                setSelectedRoute(example.route);
                setSelectedCandidateId(null);
                setStep(0);
              }}
              type="button"
            >
              <strong>{example.label}</strong>
              <span>{example.places}</span>
            </button>
          ))}
        </div>

        <div className="wizard-steps">
          {[
            "Show historical places",
            "Add waiting evidence",
            "Add moving evidence",
            "Overlap confidence",
          ].map((label, index) => (
            <button
              className={index === step ? "wizard-step active" : "wizard-step"}
              key={label}
              onClick={() => setStep(index)}
              type="button"
            >
              <span>0{index + 1}</span>
              <strong>{label}</strong>
            </button>
          ))}
        </div>

        <div className="wizard-content">
          {step === 0 ? (
            <WizardPanel
              title={`Historical places on ${selectedRoute}`}
              text="The first layer shows only historical route paths and repeated named stops. This lets people see the line geography before any confidence claim is made."
              meta={manifest ? `${manifest.window.start} to ${manifest.window.end} · ${tracks.length} vehicle histories` : "loading"}
            />
          ) : null}
          {step === 1 ? (
            <WizardPanel
              title="Waiting evidence"
              text={selectedCandidate ? `Low-speed samples are now visible around ${selectedCandidate.candidate.lat.toFixed(5)}, ${selectedCandidate.candidate.lng.toFixed(5)}. These are possible red-light or stop-line waits, not yet a final signal.` : "loading"}
              meta={selectedCandidate ? `${selectedCandidate.stopResumeMarkers.stopCount} low-speed markers` : "loading"}
            />
          ) : null}
          {step === 2 ? (
            <WizardPanel
              title="Moving evidence"
              text="Moving samples are added after the waits. If the same route resumes from the same corridor, the candidate becomes easier to explain."
              meta={selectedCandidate ? `${selectedCandidate.stopResumeMarkers.resumeCount} movement markers` : "loading"}
            />
          ) : null}
          {step === 3 ? (
            <WizardPanel
              title="Confidence overlap"
              text="Only now do the waiting and moving layers become a confidence halo. The score means repeated observations line up in the same place with low residual error."
              meta={selectedCandidate ? `${Math.round(selectedCandidate.finalConfidence * 100)}% final confidence` : "loading"}
            />
          ) : null}
        </div>

        <div className="historical-place-list">
          <h2>Historical places</h2>
          {historicalPlaces.slice(0, 5).map((place) => (
            <div className="historical-place-row" key={place.name}>
              <strong>{place.name}</strong>
              <span>{place.waitingSamples} waiting of {place.samples} samples</span>
            </div>
          ))}
        </div>

        <div className="wizard-footer">
          <div className="wizard-kpi">
            <span>Candidate</span>
            <strong>{selectedCandidate ? selectedCandidate.id : "loading"}</strong>
          </div>
          <div className="wizard-kpi">
            <span>Routes</span>
            <strong>{selectedCandidate ? selectedCandidate.routeCount : "loading"}</strong>
          </div>
          <div className="wizard-kpi">
            <span>Confidence</span>
            <strong>{selectedCandidate ? `${Math.round(selectedCandidate.finalConfidence * 100)}%` : "loading"}</strong>
          </div>
        </div>

        <section className="traffic-bottom traffic-bottom-floating">
          <article className="panel traffic-convergence">
            <div className="panel-heading">
              <div>
                <h2>Confidence rising in real time</h2>
                <p className="paper-meta">Residual error and confidence history for the selected candidate.</p>
              </div>
              <div className="big-score">{selectedCandidate ? `${Math.round(selectedCandidate.finalConfidence * 100)}%` : "loading"}</div>
            </div>
            <AnalysisChart candidate={selectedCandidate ?? best} />
          </article>
          <article className="panel traffic-evidence">
            <h2>Ranked candidates</h2>
            <div className="candidate-list">
              {topCandidates.map((candidate, index) => (
                <button
                  className={candidate.id === selectedCandidate?.id ? "candidate-row active" : "candidate-row"}
                  key={candidate.id}
                  onClick={() => setSelectedCandidateId(candidate.id)}
                  type="button"
                >
                  <div className="candidate-rank">{index + 1}</div>
                  <div className="candidate-body">
                    <strong>{candidate.route || "mixed routes"}</strong>
                    <span>
                      {candidate.candidate.lat.toFixed(5)}, {candidate.candidate.lng.toFixed(5)}
                    </span>
                  </div>
                  <div className="candidate-score">{Math.round(candidate.finalConfidence * 100)}%</div>
                </button>
              ))}
            </div>
          </article>
        </section>
      </aside>
    </main>
  );
}

function WizardPanel({ title, text, meta }: { title: string; text: string; meta: string }) {
  return (
    <div className="wizard-panel-body">
      <h2>{title}</h2>
      <p>{text}</p>
      <span>{meta}</span>
    </div>
  );
}

function AnalysisMap({ best }: { best?: TrafficLightIntersectionAnalysis["candidates"][number] }) {
  const target = best?.candidate ?? { lng: 21.2087, lat: 45.7489 };
  return (
    <div className="analysis-map-shell">
      <div className="analysis-map-header">
        <h3>Overlap field</h3>
        <p>{best ? `Candidate ${best.id} at ${best.approachHeadingDeg.toFixed(1)}°` : "Waiting for analysis output"}</p>
      </div>
      <svg viewBox="0 0 800 520" className="analysis-map-svg" role="img" aria-label="Overlap map">
        <defs>
          <linearGradient id="trackFade" x1="0" x2="1">
            <stop offset="0%" stopColor="rgba(124,255,178,0.15)" />
            <stop offset="100%" stopColor="rgba(101,214,255,0.9)" />
          </linearGradient>
        </defs>
        <rect width="800" height="520" rx="28" fill="rgba(2,6,12,0.65)" />
        <g opacity="0.35">
          {[120, 220, 320, 420].map((y) => (
            <line key={y} x1="80" y1={y} x2="720" y2={y} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
          ))}
          {[120, 220, 320, 420].map((x) => (
            <line key={x} x1={x} y1="80" x2={x} y2="440" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
          ))}
        </g>
        {[0, 1, 2, 3].map((i) => (
          <path
            key={i}
            d={`M ${120 + i * 18} ${120 + i * 30} C ${210 + i * 16} ${160 + i * 15}, ${520 - i * 8} ${330 - i * 14}, ${690 - i * 18} ${430 - i * 36}`}
            stroke="url(#trackFade)"
            strokeWidth={5 - i}
            opacity={0.7 - i * 0.12}
            fill="none"
          />
        ))}
        <circle cx="410" cy="255" r="44" fill="rgba(255,209,102,0.12)" />
        <circle cx="410" cy="255" r="15" fill="#ffd166" />
        <circle cx="410" cy="255" r="7" fill="#03070d" />
        <path d="M392 162 L428 162 L410 124 Z" fill="#7cffb2" opacity="0.95" />
        <text x="40" y="52" fill="#edf7ff" fontSize="18">Candidate center</text>
        <text x="40" y="80" fill="#92a9ba" fontSize="14">
          {target.lat.toFixed(5)}, {target.lng.toFixed(5)}
        </text>
      </svg>
    </div>
  );
}

function AnalysisChart({ candidate }: { candidate?: TrafficLightIntersectionAnalysis["candidates"][number] }) {
  const points = candidate?.errorHistory ?? [];
  const width = 720;
  const height = 260;
  const maxError = Math.max(80, ...points.map((point) => point.errorMeters));
  const maxIndex = Math.max(1, points.length - 1);
  const line = points
    .map((point, index) => {
      const x = 20 + (index / maxIndex) * (width - 40);
      const y = height - 28 - (point.errorMeters / maxError) * (height - 56);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  return (
    <div className="analysis-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Confidence convergence chart">
        <rect x="0" y="0" width={width} height={height} rx="20" fill="rgba(2,6,12,0.45)" />
        <path d={line} fill="none" stroke="#65d6ff" strokeWidth="4" />
        <path
          d={`${line} L ${20 + (points.length > 0 ? (points.length - 1) / maxIndex : 0) * (width - 40)} ${height - 28} L 20 ${height - 28} Z`}
          fill="rgba(101,214,255,0.12)"
          stroke="none"
        />
        {points.map((point, index) => {
          const x = 20 + (index / maxIndex) * (width - 40);
          const y = height - 28 - (point.errorMeters / maxError) * (height - 56);
          return <circle key={`${point.t}-${index}`} cx={x} cy={y} r="5" fill="#7cffb2" />;
        })}
      </svg>
      <div className="analysis-chart-legend">
        <span>Residual error</span>
        <span>{candidate ? `Final confidence ${Math.round(candidate.finalConfidence * 100)}%` : "No candidate yet"}</span>
      </div>
    </div>
  );
}

function TomTomTrafficPage() {
  const [summary, setSummary] = useState<{
    slotSummary: Array<{
      label: string;
      hour: number;
      sampleCount: number;
      avgSpeedKph: number | null;
      avgSpeedRatio: number | null;
      severe: number;
      heavy: number;
      moderate: number;
      low: number;
    }>;
    pointMatrix: Array<Record<string, string>>;
    incidents: Array<{ id: string; type: string; lat: number | null; lng: number | null }>;
    meta: { collectedAt: string; bbox: number[]; flowRecordCount: number; incidentCount: number };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "heatmap" | "incidents">("summary");

  useEffect(() => {
    let cancelled = false;
    fetch("/data/traffic-flow/summary.json")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <main className="page">
        <p className="eyebrow">TomTom</p>
        <h1>Traffic flow data</h1>
        <p style={{ color: "var(--danger)" }}>Error: {error}</p>
      </main>
    );
  }

  if (!summary) {
    return (
      <main className="page">
        <p className="eyebrow">TomTom</p>
        <h1>Traffic flow data</h1>
        <p>Loading...</p>
      </main>
    );
  }

  const congestionColor: Record<string, string> = { S: "#c0392b", H: "#e67e22", M: "#f1c40f", L: "#27ae60" };
  const congestionLabel: Record<string, string> = { S: "Severe", H: "Heavy", M: "Moderate", L: "Low" };
  const timeSlotLabels = summary.slotSummary.map((s) => s.label);
  const maxSevere = Math.max(...summary.slotSummary.map((s) => s.severe), 1);

  return (
    <main className="page">
      <div className="page-intro">
        <p className="eyebrow">TomTom Traffic API</p>
        <h1>Flow segment data — Timișoara</h1>
        <p>{summary.meta.flowRecordCount} records · {summary.meta.incidentCount} incidents · collected {summary.meta.collectedAt}</p>
      </div>

      <div className="toolbar">
        <div className="sheet-tabs" role="tablist">
          {(["summary", "heatmap", "incidents"] as const).map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? "sheet-tab active" : "sheet-tab"}
              onClick={() => setActiveTab(tab)}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <a className="btn secondary" href="/map">
          View on map
        </a>
        <button
          className="btn secondary"
          onClick={() => {
            const a = document.createElement("a");
            a.href = "/data/traffic-flow/tomtom-latest.json";
            a.download = "tomtom-flow-latest.json";
            a.click();
          }}
          type="button"
        >
          Download JSON
        </button>
      </div>

      {activeTab === "summary" && (
        <section>
          <div className="tomtom-summary-grid">
            {summary.slotSummary.map((slot) => (
              <div key={slot.label} className="tomtom-slot-card">
                <div className="tomtom-slot-header">
                  <strong>{slot.label}</strong>
                  <span style={{ fontFamily: "monospace", fontSize: 11 }}>{slot.hour}:00</span>
                </div>
                <div className="tomtom-slot-metric">
                  <span className="tomtom-big-value">{slot.avgSpeedKph ?? "—"}</span>
                  <span className="tomtom-unit">km/h avg</span>
                </div>
                <div className="tomtom-slot-metric">
                  <span className="tomtom-big-value">{slot.avgSpeedRatio ?? "—"}</span>
                  <span className="tomtom-unit">speed ratio</span>
                </div>
                <div className="tomtom-congestion-bar">
                  <div className="bar-segment" style={{ background: "#c0392b", flex: slot.severe / maxSevere, minWidth: 4 }} title={`Severe: ${slot.severe}`} />
                  <div className="bar-segment" style={{ background: "#e67e22", flex: slot.heavy / maxSevere }} title={`Heavy: ${slot.heavy}`} />
                  <div className="bar-segment" style={{ background: "#f1c40f", flex: slot.moderate / maxSevere }} title={`Moderate: ${slot.moderate}`} />
                  <div className="bar-segment" style={{ background: "#27ae60", flex: slot.low / maxSevere }} title={`Low: ${slot.low}`} />
                </div>
                <div className="tomtom-legend">
                  {(["S", "H", "M", "L"] as const).map((key) => (
                    <span key={key} className="tomtom-legend-item">
                      <span style={{ background: congestionColor[key], borderRadius: 2, display: "inline-block", height: 8, width: 8 }} />
                      {key}={slot[key === "S" ? "severe" : key === "H" ? "heavy" : key === "M" ? "moderate" : "low"]}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20, display: "flex", gap: 20, flexWrap: "wrap" }}>
            {Object.entries(congestionLabel).map(([key, label]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: congestionColor[key] }} />
                <span style={{ fontSize: 12 }}>
                  {label} ({key}) — ratio {key === "S" ? "<0.4" : key === "H" ? "0.4–0.65" : key === "M" ? "0.65–0.85" : "≥0.85"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === "heatmap" && (
        <section>
          <p className="lede" style={{ marginBottom: 16 }}>
            Congestion level per sample point. Rows = 5×5 grid (p-1-1 SW, p-5-5 NE). Columns = time slots.
          </p>
          <div className="heatmap-grid" style={{ fontSize: 11 }}>
            <div className="heatmap-row heatmap-header" style={{ gridTemplateColumns: "56px repeat(6, 1fr)" }}>
              <span className="heatmap-cell">Point</span>
              {timeSlotLabels.map((l) => (
                <span key={l} className="heatmap-cell" style={{ fontSize: 9 }}>
                  {l.replace("-rush", "").replace("afternoon-", "PM ").replace("morning-", "AM ").replace("mid-", "")}
                </span>
              ))}
            </div>
            {summary.pointMatrix.map((row) => (
              <div key={row.pointId} className="heatmap-row" style={{ gridTemplateColumns: "56px repeat(6, 1fr)" }}>
                <span className="heatmap-cell heatmap-point" style={{ fontSize: 10 }}>{row.pointId}</span>
                {timeSlotLabels.map((l) => {
                  const val = row[l] ?? "-";
                  return (
                    <span
                      key={l}
                      className="heatmap-cell"
                      style={{
                        background: val === "-" ? "#1a1a1a" : congestionColor[val] ?? "#1a1a1a",
                        color: val !== "-" ? "white" : "#666",
                        fontWeight: "700",
                        fontSize: 12,
                      }}
                      title={`${row.pointId} @ ${l}: ${val === "-" ? "no data" : congestionLabel[val] ?? val}`}
                    >
                      {val}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
            {Object.entries(congestionLabel).map(([key, label]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 18, height: 18, borderRadius: 4, background: congestionColor[key] }} />
                <span style={{ fontSize: 12 }}>{label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === "incidents" && (
        <section>
          <p className="lede" style={{ marginBottom: 16 }}>
            {summary.incidents.length} incidents — bbox [{summary.meta.bbox.join(", ")}]
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {summary.incidents.map((inc) => (
              <div key={inc.id} className="panel" style={{ padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontFamily: "monospace", fontSize: 12 }}>{inc.id}</strong>
                  <span style={{
                    background: inc.type === "closure" ? "#c0392b" : inc.type === "roadwork" ? "#e67e22" : "#7cffb2",
                    borderRadius: 999, color: "#03070d", fontSize: 10, fontWeight: 700, padding: "2px 8px",
                  }}>
                    {inc.type}
                  </span>
                </div>
                <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 11, color: "var(--muted)" }}>
                  {inc.lat != null ? `${inc.lat.toFixed(5)}, ${inc.lng?.toFixed(5)}` : "no coordinates"}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function HomePage() {
  return (
    <main className="page">
      <section className="hero">
        <div className="hero-copy panel">
          <p className="eyebrow">Timișoara traffic simulator</p>
          <h1>A live city environment for models, signals, cars, buses, and people.</h1>
          <p className="lede">
            OpenTrafficTM turns OSM geometry, scenario packs, and traffic-light intervals into a
            demo-ready product. The map is the primary surface; the data pages expose the manifests
            behind it.
          </p>
          <div className="cta-row">
            <a className="btn primary" href="/map">
              Launch live map
            </a>
            <a className="btn secondary" href="/papers">
              Read methodology
            </a>
          </div>
          <div className="stats">
            <Metric value="lazy" label="map renderer loading" />
            <Metric value="manifest" label="scenario, paper, and leaderboard data" />
            <Metric value="offline" label="fallback-safe demo mode" />
          </div>
        </div>
        <div className="hero-map panel">
          <NetworkArt compact={false} />
          <div className="glass-stack">
            <Metric value="MapLibre" label="OSM-first renderer" />
            <Metric value="STPT" label="probe feed with cached fallback" />
            <Metric value="SUMO" label="adapter contract ready" />
          </div>
        </div>
      </section>
      <section className="section-grid">
        <FeatureCard
          title="Map first"
          text="The live map now loads behind a lazy boundary and keeps a network-free fallback for blocked tiles or feed failures."
        />
        <FeatureCard
          title="Manifest-backed data"
          text="Scenarios, papers, sources, and leaderboards are presented as explicit local contracts instead of loose placeholder lists."
        />
        <FeatureCard
          title="Reproducible runs"
          text="The map exposes scenario and trace exports so demo runs can be replayed, compared, and shared."
        />
      </section>
    </main>
  );
}

function MapLoading() {
  return (
    <main className="map-page">
      <div className="map-canvas">
        <div className="fallback-map loading-fallback">
          <div className="fallback-veil" />
        </div>
      </div>
      <aside className="sim-panel">
        <p className="eyebrow">Loading map</p>
        <h2>Preparing the simulator</h2>
        <p>The map renderer is loading separately so the rest of the app stays fast.</p>
      </aside>
    </main>
  );
}

function DatasetsPage() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return datasets;
    return datasets.filter((dataset) =>
      [dataset.name, dataset.description, dataset.folder, dataset.source, dataset.format.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query]);

  return (
    <main className="page">
      <PageIntro
        eyebrow="Data viewers"
        title="Data folders are ready for extraction sessions."
        text="The UI treats data as scenario-ready assets: OSM geometry, SUMO outputs, traffic-light intervals, actors, submissions, and papers."
      />
      <div className="toolbar">
        <input
          aria-label="Filter datasets"
          className="search-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter datasets, formats, or folders"
          value={query}
        />
        <span className="toolbar-note">{filtered.length} of {datasets.length}</span>
      </div>
      <section className="card-grid">
        {filtered.map((dataset) => (
          <FeatureCard
            key={dataset.id}
            title={dataset.name}
            text={`${dataset.description} Folder: ${dataset.folder}. Formats: ${dataset.format.join(", ")}.`}
          />
        ))}
      </section>
      <div className="cta-row">
        <a className="btn secondary" href="/sheet">
          Open spreadsheet view
        </a>
      </div>
    </main>
  );
}

type ScenarioCatalog = ScenarioCatalogManifest | null;

function ScenariosPage() {
  const [manifest, setManifest] = useState<ScenarioCatalog>(null);

  useEffect(() => {
    let active = true;

    fetch("/data/scenarios/manifest.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Manifest not found (${response.status})`);
        return response.json() as Promise<ScenarioCatalogManifest>;
      })
      .then((json) => {
        if (active) setManifest(json);
      })
      .catch(() => {
        if (active) setManifest(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const entries = manifest?.entries ?? scenarios.map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    district: scenario.district,
    corridor: scenario.boundsLabel,
    task: scenario.description,
    groundTruth: scenario.durationSeconds / 46,
  }));

  return (
    <main className="page">
      <PageIntro
        eyebrow="Scenario packs"
        title="A shared input format for every model backend."
        text="Browser-native, SUMO, and future SOTA adapters should read the same scenario contract and emit comparable traces."
      />
      <div className="toolbar">
        <span className="toolbar-note">{manifest?.generatedAt ?? "fallback scenario catalog"}</span>
        <button
          className="btn secondary"
          onClick={() =>
            downloadJson("opentraffictm-scenario-catalog.json", {
              generatedAt: manifest?.generatedAt ?? new Date().toISOString(),
              scope: manifest?.scope ?? "fallback",
              entries,
            })
          }
          type="button"
        >
          Download catalog
        </button>
      </div>
      <section className="scenario-list">
        {entries.map((scenario, index) => (
          <article className="wide-card" key={scenario.id}>
            <div>
              <p className="eyebrow">{scenario.id}</p>
              <h3>{scenario.name}</h3>
              <p>{scenario.task}</p>
              <p className="paper-meta">
                {scenario.district} · {scenario.corridor}
              </p>
            </div>
            <div className="metrics-grid tight">
              <Metric value={String(index + 1)} label="catalog order" />
              <Metric value={scenario.groundTruth.toFixed(1)} label="reference score" />
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function LeaderboardsPage() {
  const [manifest, setManifest] = useState<LeaderboardManifest | null>(null);

  useEffect(() => {
    let active = true;

    fetch("/data/leaderboards/manifest.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Manifest not found (${response.status})`);
        return response.json() as Promise<LeaderboardManifest>;
      })
      .then((json) => {
        if (active) setManifest(json);
      })
      .catch(() => {
        if (active) setManifest(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const rows: Array<{ track: string; name: string; score: number; scenarios: number; schemaErrors: number; summary: string }> =
    manifest?.tracks.flatMap((track) =>
      track.entries.map((entry) => ({
        track: track.track,
        name: entry.name,
        score: entry.score,
        scenarios: entry.scenarios,
        schemaErrors: entry.schemaErrors,
        summary: entry.summary,
      })),
    ) ?? leaderboards.map((entry) => {
      const { track, ...rest } = entry;
      return { track, ...rest };
    });

  return (
    <main className="page">
      <PageIntro
        eyebrow="Benchmarks"
        title="Leaderboards compare humans, agents, browser models, SUMO, and future SOTA runs."
        text="Scores stay scenario-based so traffic-light interval comparisons can be introduced without changing the ranking frame."
      />
      <section className="metrics-grid tight">
        <Metric value={String(rows.length)} label="published runs" />
        <Metric value={String(manifest?.tracks.length ?? 0)} label="manifest tracks" />
        <Metric value={String(rows.filter((row) => row.schemaErrors === 0).length)} label="schema-clean runs" />
        <Metric value="scenario-based" label="scoring frame" />
      </section>
      <section className="leaderboard">
        {rows.map((entry, index) => (
          <article className="leaderboard-row" key={`${entry.track}-${entry.name}`}>
            <strong>#{index + 1}</strong>
            <div>
              <h3>{entry.name}</h3>
              <p>{entry.summary}</p>
              <p className="paper-meta">
                {entry.scenarios} scenarios · {entry.schemaErrors} schema errors
              </p>
            </div>
            <span>{entry.track}</span>
            <b>{entry.score.toFixed(1)}</b>
          </article>
        ))}
      </section>
    </main>
  );
}

function SourcesPage() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return officialSources;
    return officialSources.filter((source) =>
      [source.organization, source.name, source.purpose, source.url, source.note, source.localFolder ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query]);

  return (
    <main className="page">
      <PageIntro
        eyebrow="Official sources"
        title="Municipal feeds and notices kept locally for the traffic model."
        text="These are the official source endpoints behind the live closures, transit probes, and open mobility data used by the app."
      />
      <div className="toolbar">
        <input
          aria-label="Filter sources"
          className="search-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by organization, purpose, or local folder"
          value={query}
        />
        <span className="toolbar-note">{filtered.length} of {officialSources.length}</span>
      </div>
      <section className="metrics-grid tight">
        <Metric value={String(officialSources.length)} label="official sources" />
        <Metric
          value={String(datasets.filter((dataset) => dataset.folder.startsWith("data/sources/")).length)}
          label="local source datasets"
        />
        <Metric value="local-first" label="storage policy" />
        <Metric value="public" label="source type" />
      </section>
      <section className="card-grid">
        {filtered.map((source) => (
          <article className="panel card" key={source.id}>
            <p className="eyebrow">{source.organization}</p>
            <h3>{source.name}</h3>
            <p>{source.purpose}</p>
            <p className="paper-meta">{source.note}</p>
            <p className="paper-meta">{source.localFolder ?? "No local folder"}</p>
            <div className="cta-row">
              <a className="btn secondary" href={source.url} rel="noreferrer" target="_blank">
                Official source
              </a>
            </div>
          </article>
        ))}
      </section>
      <div className="cta-row">
        <a className="btn secondary" href="/sheet">
          Open spreadsheet view
        </a>
      </div>
    </main>
  );
}

type SpreadsheetTab = "closures" | "sources" | "datasets";

function SpreadsheetPage() {
  const [activeTab, setActiveTab] = useState<SpreadsheetTab>("closures");

  const closureRows = useMemo(
    () =>
      scenarios.map((scenario) => [
        scenario.id,
        scenario.name,
        scenario.district,
        scenario.boundsLabel,
        String(scenario.actors.length),
        String(scenario.signals.length),
        String(scenario.durationSeconds),
      ]),
    [],
  );

  const sourceRows = useMemo(
    () =>
      officialSources.map((source) => [
        source.organization,
        source.name,
        source.purpose,
        source.url,
        source.localFolder ?? "none",
        source.note,
      ]),
    [],
  );

  const datasetRows = useMemo(
    () =>
      datasets.map((dataset) => [
        dataset.name,
        dataset.folder,
        dataset.format.join(", "),
        dataset.source,
        dataset.description,
      ]),
    [],
  );

  const tabs: Array<{ id: SpreadsheetTab; label: string; count: number }> = [
    { id: "closures", label: "Scenarios", count: closureRows.length },
    { id: "sources", label: "Sources", count: sourceRows.length },
    { id: "datasets", label: "Datasets", count: datasetRows.length },
  ];

  const currentSheet =
    activeTab === "closures"
      ? {
          title: "Scenario catalog",
          subtitle: "Structured scenario metadata exposed as a spreadsheet view.",
          columns: ["ID", "Name", "District", "Bounds", "Actors", "Signals", "Duration"],
          rows: closureRows,
          linkColumns: [] as number[],
        }
      : activeTab === "sources"
        ? {
            title: "Official source inventory",
            subtitle: "Local source entries loaded from the manifest-aware source list.",
            columns: ["Organization", "Name", "Purpose", "URL", "Local folder", "Notes"],
            rows: sourceRows,
            linkColumns: [3],
          }
        : {
            title: "Dataset index",
            subtitle: "The data folders the app actually reads from.",
            columns: ["Dataset", "Folder", "Formats", "Source", "Description"],
            rows: datasetRows,
            linkColumns: [] as number[],
          };

  return (
    <main className="page spreadsheet-page">
      <PageIntro
        eyebrow="Spreadsheet view"
        title="The model inputs are exposed as raw tabular sheets."
        text="Same local records, but shown directly from the manifests and exported lists the app actually consumes."
      />
      <div className="sheet-tabs" role="tablist" aria-label="Spreadsheet sheets">
        {tabs.map((tab) => (
          <button
            aria-selected={tab.id === activeTab}
            className={tab.id === activeTab ? "sheet-tab active" : "sheet-tab"}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
            <span>{tab.count}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <span className="toolbar-note">{currentSheet.title}</span>
        <button
          className="btn secondary"
          onClick={() =>
            downloadJson("opentraffictm-spreadsheet.json", {
              sheet: currentSheet.title,
              columns: currentSheet.columns,
              rows: currentSheet.rows,
            })
          }
          type="button"
        >
          Download sheet
        </button>
      </div>
      <section className="sheet-panel" aria-label={currentSheet.title}>
        <div className="sheet-panel-head">
          <div>
            <strong>{currentSheet.title}</strong>
            <p>{currentSheet.subtitle}</p>
          </div>
          <div className="sheet-panel-meta">
            <span>{currentSheet.rows.length} rows</span>
            <span>{currentSheet.columns.length} columns</span>
          </div>
        </div>
        <SpreadsheetGrid columns={currentSheet.columns} rows={currentSheet.rows} linkColumns={currentSheet.linkColumns} />
      </section>
    </main>
  );
}

function SpreadsheetGrid({
  columns,
  rows,
  linkColumns,
}: {
  columns: string[];
  rows: string[][];
  linkColumns: number[];
}) {
  const linkColumnSet = new Set(linkColumns);

  return (
    <div className="spreadsheet" role="table" aria-label="Spreadsheet data">
      <div
        className="spreadsheet-header"
        role="row"
        style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(180px, 1fr))` }}
      >
        <div className="spreadsheet-index header-cell">#</div>
        {columns.map((column) => (
          <div className="spreadsheet-cell header-cell" key={column} role="columnheader">
            {column}
          </div>
        ))}
      </div>
      <div className="spreadsheet-body">
        {rows.map((row, rowIndex) => (
          <div
            className="spreadsheet-row"
            key={`${rowIndex}-${row[0] ?? ""}`}
            role="row"
            style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(180px, 1fr))` }}
          >
            <div className="spreadsheet-index" role="cell">
              {rowIndex + 1}
            </div>
            {row.map((cell, cellIndex) => {
              const isUrl = linkColumnSet.has(cellIndex) && /^https?:\/\//i.test(cell);
              return (
                <div className="spreadsheet-cell" key={`${rowIndex}-${cellIndex}`} role="cell">
                  {isUrl ? (
                    <a href={cell} rel="noreferrer" target="_blank">
                      {cell}
                    </a>
                  ) : (
                    cell
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function PapersPage() {
  const [query, setQuery] = useState("");
  const [accessFilter, setAccessFilter] = useState<"all" | "open" | "restricted">("all");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<{
    generatedAt: string;
    scope: string;
    counts: { total: number; openAccess: number; downloaded: number; metadataOnly: number };
    papers: Array<{
      id: string;
      title: string;
      year: number;
      authors: string[];
      venue: string | null;
      doi: string | null;
      sourceUrl: string | null;
      pdfUrl: string | null;
      access: string;
      category: string;
      relevance: string;
      download: { status: "downloaded" | "unavailable"; filePath?: string };
    }>;
  } | null>(null);

  useEffect(() => {
    let active = true;

    fetch("/data/papers/manifest.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Manifest not found (${response.status})`);
        return response.json();
      })
      .then((json) => {
        if (active) {
          setManifest(json);
          setLoadError(null);
        }
      })
      .catch((error) => {
        if (active) {
          setManifest(null);
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const papers = manifest?.papers ?? technicalPapers.map((paper) => ({
    id: paper.title,
    title: paper.title,
    year: 0,
    authors: [],
    venue: null,
    doi: null,
    sourceUrl: null,
    pdfUrl: null,
    access: paper.status === "Open access" ? "open" : "restricted",
    category: "fallback",
    relevance: paper.summary,
    download: { status: "unavailable" as const },
  }));

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return papers.filter((paper) => {
      const matchesAccess = accessFilter === "all" ? true : paper.access === accessFilter;
      const matchesQuery = !needle
        ? true
        : [paper.title, paper.relevance, paper.category, paper.venue ?? "", paper.authors.join(" ")]
            .join(" ")
            .toLowerCase()
            .includes(needle);
      return matchesAccess && matchesQuery;
    });
  }, [accessFilter, papers, query]);

  return (
    <main className="page">
      <PageIntro
        eyebrow="Technical papers"
        title="The papers section documents assumptions, models, and validation."
        text={
          manifest
            ? `Loaded ${manifest.counts.total} Timisoara-first papers from ${manifest.generatedAt}.`
            : "This is the place for hackathon methodology, model cards, data provenance, limitations, and real traffic-light comparisons."
        }
      />
      <div className="toolbar">
        <input
          aria-label="Filter papers"
          className="search-input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter papers, categories, venues, or authors"
          value={query}
        />
        <select onChange={(event) => setAccessFilter(event.target.value as "all" | "open" | "restricted")} value={accessFilter}>
          <option value="all">All access</option>
          <option value="open">Open access</option>
          <option value="restricted">Restricted</option>
        </select>
      </div>
      {manifest ? (
        <section className="metrics-grid tight" aria-label="paper corpus summary">
          <Metric value={String(manifest.counts.total)} label="papers" />
          <Metric value={String(manifest.counts.openAccess)} label="open access" />
          <Metric value={String(manifest.counts.downloaded)} label="downloaded" />
          <Metric value={String(manifest.counts.metadataOnly)} label="metadata only" />
        </section>
      ) : null}
      {loadError ? <p className="lede">Using fallback paper stubs: {loadError}.</p> : null}
      <section className="card-grid">
        {filtered.map((paper) => (
          <article className="panel card" key={paper.id}>
            <p className="eyebrow">
              {paper.year || "fallback"} · {paper.access}
            </p>
            <h3>{paper.title}</h3>
            <p>{paper.relevance || paper.title}</p>
            <p className="paper-meta">
              {paper.authors.length > 0 ? paper.authors.join(", ") : "No author metadata"}
            </p>
            <p className="paper-meta">
              {paper.venue ?? "Venue not recorded"}
              {paper.doi ? ` · DOI ${paper.doi}` : ""}
            </p>
            <p className="paper-meta">Category: {paper.category}</p>
            <div className="cta-row">
              {paper.sourceUrl ? (
                <a className="btn secondary" href={paper.sourceUrl} rel="noreferrer" target="_blank">
                  Source
                </a>
              ) : null}
              {paper.download.status === "downloaded" && paper.download.filePath ? (
                <a className="btn secondary" href={`/${paper.download.filePath}`} target="_blank">
                  PDF
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function PageIntro({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <section className="page-intro">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{text}</p>
    </section>
  );
}

function FeatureCard({ title, text }: { title: string; text: string }) {
  return (
    <article className="panel card">
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function NetworkArt({ compact }: { compact: boolean }) {
  return (
    <div className={compact ? "network-art compact" : "network-art"}>
      <div className="road road-a" />
      <div className="road road-b" />
      <div className="road road-c" />
      <div className="road road-d" />
      <div className="zone zone-a" />
      <div className="zone zone-b" />
      <div className="zone zone-c" />
    </div>
  );
}

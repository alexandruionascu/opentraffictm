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
import { simulateScenario } from "./simulation";
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

const LiveMap = lazy(() => import("./map/LiveMap").then((module) => ({ default: module.LiveMap })));

const navItems = [
  { path: "/", label: "Home" },
  { path: "/map", label: "Live Map" },
  { path: "/datasets", label: "Data" },
  { path: "/sources", label: "Sources" },
  { path: "/validation", label: "Validation" },
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
  const isMap = path === "/map";

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
      {path === "/tomtom" ? <TomTomTrafficPage /> : null}
      {path === "/sheet" ? <SpreadsheetPage /> : null}
      {path === "/scenarios" ? <ScenariosPage /> : null}
      {path === "/leaderboards" ? <LeaderboardsPage /> : null}
      {path === "/papers" ? <PapersPage /> : null}
      {!["/map", "/datasets", "/sources", "/validation", "/tomtom", "/sheet", "/scenarios", "/leaderboards", "/papers"].includes(path) ? (
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

function TomTomTrafficPage() {
  const [snapshot, setSnapshot] = useState<{
    collectedAt?: string;
    bbox?: [number, number, number, number];
    segments?: Array<{ segmentId?: string; roadName?: string; speedKph?: number; delaySeconds?: number; congestionLevel?: string }>;
    incidents?: Array<{ incidentId?: string; kind?: string; description?: string; severity?: number }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/traffic-validation/providers/tomtom/latest.json")
      .then(async (response) => {
        if (!response.ok) throw new Error("TomTom snapshot unavailable");
        return response.json();
      })
      .then((json) => {
        if (!cancelled) setSnapshot(json);
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : "TomTom snapshot unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="map-page">
      <aside className="sim-panel">
        <p className="eyebrow">TomTom</p>
        <h2>Traffic snapshot</h2>
        <p>Click a row to highlight the matching TomTom flow segment or incident on the map.</p>
        <div className="toolbar">
          <a className="btn secondary" href="/validation">
            Back
          </a>
          <span className="toolbar-note">
            {error
              ? error
              : `${snapshot?.segments?.length ?? 0} flow, ${snapshot?.incidents?.length ?? 0} incidents, ${(snapshot?.segments?.length ?? 0) + (snapshot?.incidents?.length ?? 0)} total`}
          </span>
        </div>
        <div className="scenario-picker">
          {(snapshot?.segments ?? []).map((segment, index) => {
            const key = `flow:${segment.segmentId ?? index}`;
            return (
              <button
                key={key}
                className={selectedKey === key ? "scenario-chip active" : "scenario-chip"}
                onClick={() => setSelectedKey(key)}
                type="button"
              >
                <strong>{segment.roadName ?? `Flow segment ${index + 1}`}</strong>
                <span>{segment.speedKph ?? 0} km/h</span>
              </button>
            );
          })}
          {(snapshot?.incidents ?? []).map((incident, index) => {
            const key = `incident:${incident.incidentId ?? index}`;
            return (
              <button
                key={key}
                className={selectedKey === key ? "scenario-chip active" : "scenario-chip"}
                onClick={() => setSelectedKey(key)}
                type="button"
              >
                <strong>{incident.kind ?? `Incident ${index + 1}`}</strong>
                <span>{incident.severity !== undefined ? `severity ${incident.severity}` : "incident"}</span>
              </button>
            );
          })}
        </div>
      </aside>
      <Suspense fallback={<MapLoading />}>
        <LiveMap scenarios={[emptyScenario]} probeSource="tomtom" validationOnly selectedProbeKey={selectedKey} />
      </Suspense>
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

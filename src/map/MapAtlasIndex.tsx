import { useEffect, useMemo, useState } from "react";
import { mapAtlasViews } from "./mapAtlas";

interface ManifestPage {
  id: string;
  path: string;
  title: string;
  category: string;
  description: string;
  artifacts: string[];
  featureCount: number;
  freshness: string;
  caveats: string[];
}

interface MapViewsManifest {
  generatedAt: string;
  pages: ManifestPage[];
  artifactWarnings: Array<{ path: string; warning: string; bytes: number }>;
}

function formatFreshness(value: string | undefined) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function MapAtlasIndex({ navigate }: { navigate: (path: string) => void }) {
  const [manifest, setManifest] = useState<MapViewsManifest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/map-views/manifest.json")
      .then((response) => {
        if (!response.ok) throw new Error(`manifest returned ${response.status}`);
        return response.json() as Promise<MapViewsManifest>;
      })
      .then((json) => {
        if (!cancelled) setManifest(json);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Map atlas manifest could not be loaded");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pages = useMemo(() => {
    const byPath = new Map(manifest?.pages.map((page) => [page.path, page]));
    return mapAtlasViews.map((view) => {
      const page = byPath.get(view.path);
      return {
        ...view,
        manifest: page,
        featureCount: page?.featureCount ?? 0,
        freshness: page?.freshness,
      };
    });
  }, [manifest]);
  const grouped = useMemo(() => {
    return pages.reduce<Record<string, typeof pages>>((acc, page) => {
      acc[page.category] ??= [];
      acc[page.category].push(page);
      return acc;
    }, {});
  }, [pages]);

  return (
    <main className="page maps-index-page">
      <section className="page-intro maps-index-intro">
        <p className="eyebrow">Map Atlas</p>
        <h1>Fullscreen map views</h1>
        <p className="lede">
          Focused MapLibre pages backed by compact build-time artifacts. Each view fetches only its own GeoJSON or JSON output rather than reducing raw traffic, OSM, or probe histories in the browser.
        </p>
        <div className="cta-row">
          <button className="btn primary" onClick={() => navigate("/maps/tomtom-live")} type="button">
            Open TomTom flow
          </button>
          <button className="btn secondary" onClick={() => navigate("/maps/live-transit")} type="button">
            Open STPT live
          </button>
        </div>
      </section>
      {error ? <div className="map-atlas-warning">Manifest issue: {error}</div> : null}
      {manifest?.artifactWarnings.length ? (
        <div className="map-atlas-warning">
          {manifest.artifactWarnings.length} map artifact{manifest.artifactWarnings.length === 1 ? "" : "s"} exceeded the compact-size warning threshold.
        </div>
      ) : null}
      <section className="atlas-category-grid">
        {Object.entries(grouped).map(([category, categoryPages]) => (
          <div className="atlas-category-section" key={category}>
            <div className="atlas-category-heading">
              <h2>{category}</h2>
              <span>{categoryPages.length} views</span>
            </div>
            <div className="atlas-card-grid">
              {categoryPages.map((page) => (
                <button className="atlas-index-card" key={page.path} onClick={() => navigate(page.path)} type="button">
                  <span>{page.category}</span>
                  <strong>{page.title}</strong>
                  <p>{page.description}</p>
                  {page.insight ? <b>{page.insight}</b> : null}
                  <div className="atlas-card-meta">
                    <small>{page.featureCount.toLocaleString()} features</small>
                    <small>{formatFreshness(page.freshness)}</small>
                  </div>
                  <em>{page.artifactPaths.map((path) => path.replace(/^data\/map-views\//, "")).join(" + ")}</em>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

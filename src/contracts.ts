export interface ScenarioCatalogEntry {
  id: string;
  name: string;
  district: string;
  corridor: string;
  task: string;
  groundTruth: number;
}

export interface ScenarioCatalogManifest {
  generatedAt: string;
  scope: string;
  entries: ScenarioCatalogEntry[];
}

export interface LeaderboardTrackManifest {
  track: string;
  summary: string;
  entries: Array<{
    name: string;
    score: number;
    scenarios: number;
    schemaErrors: number;
    summary: string;
  }>;
}

export interface LeaderboardManifest {
  generatedAt: string;
  scope: string;
  tracks: LeaderboardTrackManifest[];
}

export interface ExportEnvelope<T> {
  generatedAt: string;
  kind: string;
  version: number;
  payload: T;
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noreferrer";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}


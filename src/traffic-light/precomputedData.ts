import type { PrecomputedTrafficLightDataset } from "./types";

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function loadPrecomputedTrafficLightDataset(): Promise<PrecomputedTrafficLightDataset> {
  return readJson<PrecomputedTrafficLightDataset>("/data/traffic-lights/analysis/inference.json");
}

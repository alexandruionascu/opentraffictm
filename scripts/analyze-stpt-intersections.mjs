import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_DIR = path.join(__dirname, '../data/traffic-lights/analysis/raw');
const OUTPUT_FILE = path.join(__dirname, '../data/traffic-lights/analysis/intersection-analysis.json');
const EXPORT_MANIFEST = path.join(__dirname, '../data/traffic-lights/analysis/export-manifest.json');

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const header = lines.shift()?.split(',') ?? [];
  return lines.filter(Boolean).map((line) => {
    const values = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          current += ch;
        }
      } else if (ch === ',') {
        values.push(current);
        current = '';
      } else if (ch === '"') {
        quoted = true;
      } else {
        current += ch;
      }
    }
    values.push(current);
    return Object.fromEntries(header.map((key, index) => [key, values[index] ?? '']));
  });
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function distance(a, b) {
  const latScale = 111_320;
  const lngScale = Math.cos(toRad((a.lat + b.lat) / 2)) * 111_320;
  return Math.hypot((a.lng - b.lng) * lngScale, (a.lat - b.lat) * latScale);
}

function avg(points) {
  const sum = points.reduce(
    (acc, point) => ({ lng: acc.lng + point.lng, lat: acc.lat + point.lat }),
    { lng: 0, lat: 0 },
  );
  return { lng: sum.lng / points.length, lat: sum.lat / points.length };
}

function circularMean(values) {
  if (values.length === 0) return 0;
  const radians = values.map((value) => toRad(value));
  const sin = radians.reduce((acc, value) => acc + Math.sin(value), 0);
  const cos = radians.reduce((acc, value) => acc + Math.cos(value), 0);
  return (Math.atan2(sin, cos) * 180) / Math.PI;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const manifest = JSON.parse(fs.readFileSync(EXPORT_MANIFEST, 'utf8'));
const rows = manifest.files.flatMap((entry) =>
  parseCsv(fs.readFileSync(path.join(INPUT_DIR, path.basename(entry.file)), 'utf8')),
);

const samples = rows
  .map((row) => ({
    vehicleId: row.vehicle_id,
    route: row.route,
    recordedAt: row.recorded_at,
    t: Number(row.server_timestamp),
    lat: Number(row.lat),
    lng: Number(row.lng),
    bearing: Number(row.bearing),
    speed: Number(row.speed),
    stopName: row.stop_name || null,
  }))
  .filter((sample) => Number.isFinite(sample.t) && Number.isFinite(sample.lat) && Number.isFinite(sample.lng));

const lowSpeedSamples = samples.filter((sample) => Number.isFinite(sample.speed) && sample.speed <= 12);
const cellSize = 0.00045;
const cells = new Map();

for (const sample of lowSpeedSamples) {
  const cellLat = Math.round(sample.lat / cellSize) * cellSize;
  const cellLng = Math.round(sample.lng / cellSize) * cellSize;
  const key = `${cellLat.toFixed(5)}:${cellLng.toFixed(5)}`;
  const bucket = cells.get(key) ?? {
    key,
    samples: [],
    routes: new Set(),
    stopNames: new Set(),
  };
  bucket.samples.push(sample);
  bucket.routes.add(sample.route);
  if (sample.stopName) bucket.stopNames.add(sample.stopName);
  cells.set(key, bucket);
}

const scoredCells = [...cells.values()]
  .map((cell) => {
    const center = avg(cell.samples);
    const residuals = cell.samples.map((sample) => distance(center, sample));
    const meanResidual = residuals.reduce((acc, value) => acc + value, 0) / residuals.length;
    const routeCount = cell.routes.size;
    const stopNameCount = cell.stopNames.size;
    const sampleCount = cell.samples.length;
    const confidence = clamp(
      0.16 +
        routeCount * 0.12 +
        Math.min(sampleCount, 80) / 110 +
        Math.min(stopNameCount, 3) * 0.05 -
        meanResidual / 220,
      0,
      0.98,
    );

    return {
      ...cell,
      center,
      residuals,
      meanResidual,
      routeCount,
      stopNameCount,
      sampleCount,
      confidence,
    };
  })
  .filter((cell) => cell.sampleCount >= 16 && cell.routeCount >= 2)
  .sort((a, b) => b.confidence - a.confidence || b.sampleCount - a.sampleCount);

const candidates = scoredCells.slice(0, 12).map((cell, index) => {
  const samplesByTime = [...cell.samples].sort((a, b) => a.t - b.t);
  const cumulative = [];
  let seenRoutes = new Set();
  for (let i = 0; i < samplesByTime.length; i += 1) {
    const sample = samplesByTime[i];
    seenRoutes = new Set([...seenRoutes, sample.route]);
    const progress = (i + 1) / samplesByTime.length;
    const routeCoverage = seenRoutes.size / cell.routeCount;
    const error = distance(cell.center, sample);
    const curveConfidence = clamp(
      cell.confidence * (0.4 + progress * 0.4 + routeCoverage * 0.2) - error / 500,
      0,
      1,
    );
    const previous = cumulative.at(-1)?.confidence ?? 0;
    cumulative.push({
      t: sample.t,
      errorMeters: Number(error.toFixed(1)),
      confidence: Number(clamp(Math.max(previous, curveConfidence), 0, 1).toFixed(3)),
    });
  }

  const heading = circularMean(
    samplesByTime
      .map((sample) => sample.bearing)
      .filter((bearing) => Number.isFinite(bearing)),
  );

  return {
    id: `candidate-${String(index + 1).padStart(2, '0')}`,
    route: [...cell.routes].slice(0, 4).join(', '),
    candidate: {
      lng: Number(cell.center.lng.toFixed(6)),
      lat: Number(cell.center.lat.toFixed(6)),
    },
    approachHeadingDeg: Number(((heading + 360) % 360).toFixed(1)),
    sampleCount: cell.sampleCount,
    routeCount: cell.routeCount,
    stopResumeMarkers: {
      stopCount: cell.sampleCount,
      resumeCount: Math.max(0, samples.length - cell.sampleCount),
      firstStopAt: samplesByTime[0]?.recordedAt ?? null,
      lastStopAt: samplesByTime.at(-1)?.recordedAt ?? null,
    },
    errorHistory: cumulative,
    finalConfidence: Number(cell.confidence.toFixed(3)),
  };
});

const analysis = {
  generatedAt: new Date().toISOString(),
  window: manifest.window,
  sourceManifest: 'export-manifest.json',
  sampleCount: samples.length,
  lowSpeedSampleCount: lowSpeedSamples.length,
  candidateCount: candidates.length,
  candidates,
};

fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(analysis, null, 2)}\n`);
console.log(`Wrote ${OUTPUT_FILE}`);

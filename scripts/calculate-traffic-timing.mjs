import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '../data/stpt.db');
const LOCATIONS_FILE = path.join(__dirname, '../data/traffic-lights/signals.json');
const OUTPUT_FILE = path.join(__dirname, '../data/traffic-lights/signals.json');

const RADIUS = 0.0005;

console.log('Loading data...');
const db = Database(DB_PATH);
const manifest = JSON.parse(fs.readFileSync(LOCATIONS_FILE, 'utf8'));
const trafficLights = manifest.programs;
console.log(`Loaded ${trafficLights.length} traffic lights`);

console.log('Loading vehicle positions...');
const positions = db.prepare(`
  SELECT lat, lng, speed, server_timestamp, id, route, bearing
  FROM vehicle_positions
  ORDER BY server_timestamp
`).all();
console.log(`Loaded ${positions.length} vehicle positions`);

function calculateTimingForLight(light, positions) {
  const nearby = positions.filter((p) => {
    const dist = Math.sqrt(
      (p.lat - light.position.lat) ** 2 + (p.lng - light.position.lng) ** 2,
    );
    return dist < RADIUS;
  });

  if (nearby.length < 5) return null;

  const stops = nearby.filter((p) => p.speed === 0);
  const moving = nearby.filter((p) => p.speed > 0);

  const stopDurations = [];
  const movingDurations = [];

  stops.sort((a, b) => a.server_timestamp - b.server_timestamp);
  for (let i = 1; i < stops.length; i++) {
    const duration =
      (stops[i].server_timestamp - stops[i - 1].server_timestamp) / 1000;
    if (duration > 0 && duration < 300) {
      stopDurations.push(duration);
    }
  }

  moving.sort((a, b) => a.server_timestamp - b.server_timestamp);
  for (let i = 1; i < moving.length; i++) {
    const duration =
      (moving[i].server_timestamp - moving[i - 1].server_timestamp) / 1000;
    if (duration > 0 && duration < 300) {
      movingDurations.push(duration);
    }
  }

  const avgRed =
    stopDurations.length > 0
      ? Math.round(
          stopDurations.reduce((a, b) => a + b, 0) / stopDurations.length,
        )
      : 30;

  const avgGreen =
    movingDurations.length > 0
      ? Math.round(
          movingDurations.reduce((a, b) => a + b, 0) / movingDurations.length,
        )
      : 40;

  return {
    offsetSeconds: Math.floor(Math.random() * 60),
    phases: [
      { state: 'green', durationSeconds: avgGreen },
      { state: 'yellow', durationSeconds: 4 },
      { state: 'red', durationSeconds: avgRed },
    ],
    sampleCount: nearby.length,
  };
}

console.log('Calculating timing for each traffic light...');

for (let i = 0; i < trafficLights.length; i++) {
  if (i % 100 === 0)
    console.log(`  Processing ${i}/${trafficLights.length}...`);
  const timing = calculateTimingForLight(trafficLights[i], positions);
  if (timing) {
    trafficLights[i].offsetSeconds = timing.offsetSeconds;
    trafficLights[i].phases = timing.phases;
    trafficLights[i].sampleCount = timing.sampleCount;
  }
}

console.log(`Updated timing for ${trafficLights.length} traffic lights`);

manifest.generatedAt = new Date().toISOString();
manifest.scope = 'Inferred from STPT vehicle positions';

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2));
console.log(`Saved to ${OUTPUT_FILE}`);

db.close();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTROLS_FILE = path.join(__dirname, '../data/osm/timisoara-controls.geojson');
const ROADS_FILE = path.join(__dirname, '../data/osm/timisoara-roads.geojson');
const OUTPUT_FILE = path.join(__dirname, '../data/traffic-lights/signals.json');

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

function bearing(lon1, lat1, lon2, lat2) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function pointToLineDistance(lon, lat, lineCoords) {
  let minDist = Infinity;
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const [x1, y1] = lineCoords[i];
    const [x2, y2] = lineCoords[i + 1];
    const dist = perpendicularDistance(lon, lat, x1, y1, x2, y2);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
}

function perpendicularDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (len * len)),
  );
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

function getNearestRoad(signalLon, signalLat, roads) {
  let nearest = null;
  let minDist = Infinity;
  let heading = 0;

  for (const feature of roads.features) {
    const coords = feature.geometry.coordinates;
    const dist = pointToLineDistance(signalLon, signalLat, coords);
    if (dist < minDist && coords.length >= 2) {
      minDist = dist;
      const first = coords[0];
      const last = coords[coords.length - 1];
      heading = bearing(first[0], first[1], last[0], last[1]);
      const isOneway = feature.properties.oneway === 'yes';
      if (!isOneway) {
        heading = (heading + 180) % 360;
      }
      nearest = { heading, dist };
    }
  }

  return nearest;
}

console.log('Loading OSM data...');
const controlsGeojson = JSON.parse(fs.readFileSync(CONTROLS_FILE, 'utf8'));
const roadsGeojson = JSON.parse(fs.readFileSync(ROADS_FILE, 'utf8'));

console.log('Finding nearest roads for each traffic signal...');
const trafficLights = controlsGeojson.features
  .filter((f) => {
    const props = f.properties;
    return props.kind === 'traffic_signal' ||
           (props.kind === 'crossing' && props.crossing === 'traffic_signals');
  })
  .map((f, idx) => {
    const lon = f.geometry.coordinates[0];
    const lat = f.geometry.coordinates[1];
    const nearest = getNearestRoad(lon, lat, roadsGeojson);

    return {
      id: `signal-${idx}`,
      name: f.properties.name || `Location ${idx}`,
      position: {
        lng: lon,
        lat: lat,
      },
      primaryHeadingDeg: nearest ? Math.round(nearest.heading) : 0,
      offsetSeconds: 0,
      phases: [
        { state: 'green', durationSeconds: 30 },
        { state: 'yellow', durationSeconds: 4 },
        { state: 'red', durationSeconds: 30 },
      ],
      kind: f.properties.kind,
      osmId: f.properties.osmId,
    };
  });

console.log(`Found ${trafficLights.length} traffic lights`);

const sample = trafficLights.slice(0, 5);
for (const tl of sample) {
  console.log(`  ${tl.name}: heading ${tl.primaryHeadingDeg}°`);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  scope: 'Inferred from STPT vehicle positions',
  programs: trafficLights,
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2));
console.log(`Saved to ${OUTPUT_FILE}`);
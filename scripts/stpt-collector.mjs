#!/usr/bin/env node
/**
 * STPT Timisoara — Real-Time Vehicle Tracking & Static Data
 * Polls live.stpt.ro every 5 seconds and records vehicle movements to SQLite.
 * Also fetches and caches static data: stations, line configs, routes, legends.
 */

import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'https://live.stpt.ro';
const VEHICLES_URL = `${BASE_URL}/gtfs-vehicles.php`;
const POLL_INTERVAL = 5;
const DB_PATH = join(__dirname, '../data/stpt.db');
const REQUEST_TIMEOUT = 10000;
const STATIC_REFRESH_HOURS = 24;
const STATIC_CHECK_INTERVAL = 17280;

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
};

function formatTime(date) {
  return date.toISOString();
}

function log(message, level = 'INFO') {
  const timestamp = formatTime(new Date());
  let prefix, color;

  switch (level) {
    case 'DEBUG':
      prefix = '[DBG]';
      color = COLORS.gray;
      break;
    case 'INFO':
      prefix = '[INF]';
      color = COLORS.green;
      break;
    case 'WARN':
      prefix = '[WRN]';
      color = COLORS.yellow;
      break;
    case 'ERROR':
      prefix = '[ERR]';
      color = COLORS.red;
      break;
    default:
      prefix = `[${level}]`;
      color = COLORS.white;
  }

  const useColor = process.stdout.isTTY;
  const msg = useColor
    ? `${COLORS.gray}${timestamp}${COLORS.reset}  ${color}${prefix}${COLORS.reset}  ${message}`
    : `${timestamp}  ${prefix}  ${message}`;

  console.log(msg);
}

function logSection(title) {
  const separator = '─'.repeat(60);
  log(separator, 'DEBUG');
  log(title, 'INFO');
  log(separator, 'DEBUG');
}

function nowISO() {
  return new Date().toISOString();
}

function initDB(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicle_positions (
      id              TEXT NOT NULL,
      route           TEXT NOT NULL,
      direction_id    TEXT,
      lat             REAL NOT NULL,
      lng             REAL NOT NULL,
      bearing         REAL,
      speed           REAL,
      headsign        TEXT,
      stop_name       TEXT,
      is_accessible   INTEGER DEFAULT 0,
      server_timestamp INTEGER,
      recorded_at     TEXT NOT NULL,
      PRIMARY KEY (id, server_timestamp)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_route_time
    ON vehicle_positions(route, server_timestamp)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_recorded
    ON vehicle_positions(recorded_at)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS last_known (
      vehicle_id  TEXT PRIMARY KEY,
      lat         REAL NOT NULL,
      lng         REAL NOT NULL,
      server_timestamp INTEGER,
      updated_at  TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL,
      lng REAL,
      address TEXT,
      raw_json TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS line_configs (
      line TEXT NOT NULL,
      stop_order INTEGER NOT NULL,
      stop_id TEXT,
      stop_name TEXT,
      stop_lat REAL,
      stop_lng REAL,
      PRIMARY KEY (line, stop_order)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS line_endpoints (
      line TEXT PRIMARY KEY,
      tur TEXT,
      retur TEXT,
      raw_json TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS legends (
      line TEXT PRIMARY KEY,
      raw_json TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS routes_geometry (
      line TEXT NOT NULL,
      direction TEXT NOT NULL,
      raw_geojson TEXT,
      PRIMARY KEY (line, direction)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS static_meta (
      data_type TEXT PRIMARY KEY,
      last_updated TEXT,
      record_count INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS discovered_lines (
      line TEXT PRIMARY KEY,
      discovered_at TEXT NOT NULL
    )
  `);


}

function loadLastKnown(db) {
  const rows = db.prepare('SELECT vehicle_id, lat, lng, server_timestamp FROM last_known').all();
  const result = new Map();
  for (const row of rows) {
    result.set(row.vehicle_id, {
      lat: row.lat,
      lng: row.lng,
      server_timestamp: row.server_timestamp
    });
  }
  return result;
}

function saveLastKnown(db, vehicleId, lat, lng, serverTimestamp) {
  db.prepare(
    'INSERT OR REPLACE INTO last_known (vehicle_id, lat, lng, server_timestamp, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(vehicleId, lat, lng, serverTimestamp, nowISO());

}

function insertPosition(db, vehicle) {
  db.prepare(
    `INSERT INTO vehicle_positions
     (id, route, direction_id, lat, lng, bearing, speed,
      headsign, stop_name, is_accessible, server_timestamp, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    vehicle.id,
    vehicle.route,
    vehicle.directionId || null,
    vehicle.lat,
    vehicle.lng,
    vehicle.bearing || null,
    vehicle.speed || null,
    vehicle.headsign || null,
    vehicle.stop || null,
    vehicle.isAccessible ? 1 : 0,
    vehicle.timestamp || null,
    nowISO()
  );

}

async function fetchWithRetry(url, options = {}, retries = 3, delayMs = 1000, retryOnError = true) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && !retryOnError) {
          return response;
        }
        if (!retryOnError) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      if (attempt === retries || !retryOnError) throw error;
      log(`Fetch attempt ${attempt}/${retries} failed: ${error.message}`, 'WARN');
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
}

async function fetchVehicles() {
  try {
    const response = await fetchWithRetry(VEHICLES_URL);
    const data = await response.json();
    return { vehicles: data?.data?.vehicles || [], error: null };
  } catch (error) {
    const errorMsg = error.name === 'AbortError'
      ? 'Request timed out'
      : `Network error: ${error.message}`;
    return { vehicles: null, error: errorMsg };
  }
}

async function fetchStations() {
  try {
    const response = await fetchWithRetry(`${BASE_URL}/stations-index.php`);
    const stations = await response.json();
    return { data: stations, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

async function fetchLineConfig(line) {
  try {
    const response = await fetchWithRetry(
      `${BASE_URL}/linii-config-json.php?line=${encodeURIComponent(line)}&v=1`
    );
    const config = await response.json();
    return { data: config, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

async function fetchLineEndpoints() {
  try {
    const response = await fetchWithRetry(`${BASE_URL}/routes/capeti-linie.json`);
    const endpoints = await response.json();
    return { data: endpoints, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

async function fetchLegends(line) {
  try {
    const response = await fetchWithRetry(`${BASE_URL}/routes/legends/${line}.json`, {}, 1, 1000, false);
    if (response.status === 404) {
      return { data: null, error: 'not_found' };
    }
    const legend = await response.json();
    return { data: legend, error: null };
  } catch (err) {
    if (err.message.includes('404')) {
      return { data: null, error: 'not_found' };
    }
    return { data: null, error: err.message };
  }
}

async function fetchRouteGeometry(line, direction) {
  try {
    const response = await fetchWithRetry(
      `${BASE_URL}/routes/${line}-${direction}.geojson`,
      {}, 1, 1000, false
    );
    if (response.status === 404) {
      return { data: null, error: 'not_found' };
    }
    const data = await response.json();
    return { data, error: null };
  } catch (err) {
    if (err.message.includes('404')) {
      return { data: null, error: 'not_found' };
    }
    return { data: null, error: err.message };
  }
}

async function discoverLinesFromHTML() {
  try {
    const response = await fetchWithRetry(BASE_URL);
    const html = await response.text();

    const $ = cheerio.load(html);
    const lines = [];

    $('a.linie-btn').each((_, el) => {
      const href = $(el).attr('href');
      const match = href?.match(/linie=([^&]+)/);
      const line = match ? match[1] : $(el).text();
      if (line && line !== '0' && line !== 'all') {
        lines.push(line.trim());
      }
    });

    if (lines.length === 0) {
      log('Could not find any .linie-btn links in main page', 'WARN');
      return { lines: [], error: 'no_linie_btn_found' };
    }

    return { lines: [...new Set(lines)], error: null };
  } catch (error) {
    return { lines: [], error: error.message };
  }
}

function getStaticMeta(db, dataType) {
  const row = db.prepare('SELECT last_updated, record_count FROM static_meta WHERE data_type = ?').get(dataType);
  return row || null;
}

function setStaticMeta(db, dataType, recordCount) {
  db.prepare(
    'INSERT OR REPLACE INTO static_meta (data_type, last_updated, record_count) VALUES (?, ?, ?)'
  ).run(dataType, nowISO(), recordCount);

}

function isStale(lastUpdated, hours = STATIC_REFRESH_HOURS) {
  if (!lastUpdated) return true;
  const lastDate = new Date(lastUpdated);
  const now = new Date();
  const diffHours = (now - lastDate) / (1000 * 60 * 60);
  return diffHours >= hours;
}

function formatDuration(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

async function loadStations(db) {
  log('Fetching stations...', 'INFO');
  const meta = getStaticMeta(db, 'stations');

  if (meta && !isStale(meta.last_updated)) {
    log(`Stations: up-to-date (${meta.record_count} stations, loaded ${formatDuration(Date.now() - new Date(meta.last_updated).getTime())} ago)`, 'INFO');
    return;
  }

  const { data: stations, error } = await fetchStations();

  if (error) {
    log(`Stations: failed to fetch - ${error}`, 'ERROR');
    return;
  }

  const insertStmt = db.prepare(
    'INSERT OR REPLACE INTO stations (id, name, lat, lng, address, raw_json) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM stations').run();

    let count = 0;
    if (stations && typeof stations === 'object' && !Array.isArray(stations)) {
      for (const [id, station] of Object.entries(stations)) {
        insertStmt.run(
          station.id || id,
          station.name || station.den || null,
          station.lat || station.latitudine || null,
          station.lng || station.longitudine || null,
          station.address || station.adresa || null,
          JSON.stringify(station)
        );
        count++;
      }
    }

    setStaticMeta(db, 'stations', count);
    return count;
  });

  const count = transaction();
  const duration = meta ? Date.now() - new Date(meta.last_updated).getTime() : 0;
  log(`Stations: loaded ${count} stations, ${meta ? `refreshed after ${formatDuration(duration)}` : 'first load'}`, 'INFO');
}

async function loadLineEndpoints(db) {
  log('Fetching line endpoints...', 'INFO');
  const meta = getStaticMeta(db, 'line_endpoints');

  if (meta && !isStale(meta.last_updated)) {
    log(`Line endpoints: up-to-date (${meta.record_count} lines, loaded ${formatDuration(Date.now() - new Date(meta.last_updated).getTime())} ago)`, 'INFO');
    return;
  }

  const { data: endpoints, error } = await fetchLineEndpoints();

  if (error) {
    log(`Line endpoints: failed to fetch - ${error}`, 'ERROR');
    return;
  }

  const insertStmt = db.prepare(
    'INSERT OR REPLACE INTO line_endpoints (line, tur, retur, raw_json) VALUES (?, ?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM line_endpoints').run();

    let count = 0;
    if (endpoints && typeof endpoints === 'object') {
      for (const [line, ep] of Object.entries(endpoints)) {
        const tur = ep?.tur || ep?.[0] || null;
        const retur = ep?.retur || ep?.[1] || null;
        insertStmt.run(line, tur, retur, JSON.stringify(ep));
        count++;
      }
    }

    setStaticMeta(db, 'line_endpoints', count);
    return count;
  });

  const count = transaction();
  const duration = meta ? Date.now() - new Date(meta.last_updated).getTime() : 0;
  log(`Line endpoints: loaded ${count} lines, ${meta ? `refreshed after ${formatDuration(duration)}` : 'first load'}`, 'INFO');
}

async function loadLineConfigs(db, lines) {
  log(`Fetching line configs for ${lines.length} lines...`, 'INFO');
  const meta = getStaticMeta(db, 'line_configs');

  if (meta && !isStale(meta.last_updated)) {
    log(`Line configs: up-to-date (${meta.record_count} configs, loaded ${formatDuration(Date.now() - new Date(meta.last_updated).getTime())} ago)`, 'INFO');
    return;
  }

  const configs = [];
  let failed = 0;

  for (const line of lines) {
    const { data: config, error } = await fetchLineConfig(line);

    if (error === 'not_found') {
      continue;
    }

    if (error) {
      log(`Line ${line}: config fetch failed - ${error}`, 'WARN');
      failed++;
      continue;
    }

    if (config && typeof config === 'object' && config[line]) {
      const lineData = config[line];
      const turStations = lineData.tur?.stations || [];
      const returStations = lineData.retur?.stations || [];
      const turCoords = lineData.tur?.coords || [];
      const returCoords = lineData.retur?.coords || [];

      const allStops = [];
      for (let i = 0; i < turStations.length; i++) {
        allStops.push({ name: turStations[i], lat: turCoords[i]?.[1], lng: turCoords[i]?.[0], direction: 'tur' });
      }
      for (let i = 0; i < returStations.length; i++) {
        allStops.push({ name: returStations[i], lat: returCoords[i]?.[1], lng: returCoords[i]?.[0], direction: 'retur' });
      }

      if (allStops.length > 0) {
        configs.push({ line, stops: allStops });
      }
    }
  }

  const insertStmt = db.prepare(
    'INSERT OR REPLACE INTO line_configs (line, stop_order, stop_id, stop_name, stop_lat, stop_lng) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM line_configs').run();

    let count = 0;
    for (const { line, stops } of configs) {
      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];
        insertStmt.run(
          line,
          i + 1,
          stop.id || stop.idStatie || null,
          stop.name || stop.den || null,
          stop.lat || stop.latitudine || null,
          stop.lng || stop.longitudine || null
        );
        count++;
      }
    }

    setStaticMeta(db, 'line_configs', count);
    return count;
  });

  const insertedCount = transaction();
  const duration = meta ? Date.now() - new Date(meta.last_updated).getTime() : 0;
  log(`Line configs: loaded ${insertedCount} stops for ${configs.length} lines, ${failed} failed, ${meta ? `refreshed after ${formatDuration(duration)}` : 'first load'}`, 'INFO');
}

async function loadLegends(db, lines) {
  log(`Fetching legends for ${lines.length} lines...`, 'INFO');
  const meta = getStaticMeta(db, 'legends');

  if (meta && !isStale(meta.last_updated)) {
    log(`Legends: up-to-date (${meta.record_count} legends, loaded ${formatDuration(Date.now() - new Date(meta.last_updated).getTime())} ago)`, 'INFO');
    return;
  }

  const legends = [];
  let notFound = 0;

  for (const line of lines) {
    const { data: legend, error } = await fetchLegends(line);

    if (error === 'not_found') {
      notFound++;
      continue;
    }

    if (error) {
      log(`Line ${line}: legend fetch failed - ${error}`, 'WARN');
      continue;
    }

    if (legend) {
      legends.push({ line, legend });
    }
  }

  const insertStmt = db.prepare(
    'INSERT OR REPLACE INTO legends (line, raw_json) VALUES (?, ?)'
  );

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM legends').run();

    for (const { line, legend } of legends) {
      insertStmt.run(line, JSON.stringify(legend));
    }

    setStaticMeta(db, 'legends', legends.length);
    return legends.length;
  });

  const insertedCount = transaction();
  const duration = meta ? Date.now() - new Date(meta.last_updated).getTime() : 0;
  log(`Legends: loaded ${insertedCount} legends, ${notFound} not found (404), ${meta ? `refreshed after ${formatDuration(duration)}` : 'first load'}`, 'INFO');
}

async function loadRoutesGeometry(db, lines) {
  log(`Fetching route geometry for ${lines.length} lines...`, 'INFO');
  const meta = getStaticMeta(db, 'routes_geometry');

  if (meta && !isStale(meta.last_updated)) {
    log(`Routes geometry: up-to-date (${meta.record_count} routes, loaded ${formatDuration(Date.now() - new Date(meta.last_updated).getTime())} ago)`, 'INFO');
    return;
  }

  const routes = [];
  let notFound = 0;

  for (const line of lines) {
    for (const direction of ['tur', 'retur']) {
      const { data: geojson, error } = await fetchRouteGeometry(line, direction);

      if (error === 'not_found') {
        notFound++;
        continue;
      }

      if (error) {
        log(`Line ${line} ${direction}: geometry fetch failed - ${error}`, 'WARN');
        continue;
      }

      if (geojson) {
        routes.push({ line, direction, geojson });
      }
    }
  }

  const insertStmt = db.prepare(
    'INSERT OR REPLACE INTO routes_geometry (line, direction, raw_geojson) VALUES (?, ?, ?)'
  );

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM routes_geometry').run();

    for (const { line, direction, geojson } of routes) {
      insertStmt.run(line, direction, JSON.stringify(geojson));
    }

    setStaticMeta(db, 'routes_geometry', routes.length);
    return routes.length;
  });

  const insertedCount = transaction();
  const duration = meta ? Date.now() - new Date(meta.last_updated).getTime() : 0;
  log(`Routes geometry: loaded ${insertedCount} route geometries, ${notFound} not found (404), ${meta ? `refreshed after ${formatDuration(duration)}` : 'first load'}`, 'INFO');
}

async function discoverAndSaveLines(db) {
  log('Discovering lines from main page...', 'INFO');
  const meta = getStaticMeta(db, 'discovered_lines');

  if (meta && !isStale(meta.last_updated)) {
    const lines = db.prepare('SELECT line FROM discovered_lines').all().map(r => r.line);
    log(`Discovered lines: up-to-date (${lines.length} lines, loaded ${formatDuration(Date.now() - new Date(meta.last_updated).getTime())} ago)`, 'INFO');
    return lines;
  }

  const { lines, error } = await discoverLinesFromHTML();

  if (error || lines.length === 0) {
    if (error) {
      log(`Discover lines: failed - ${error}`, 'ERROR');
    }
    let fallback = db.prepare('SELECT line FROM line_endpoints').all().map(r => r.line);
    if (fallback.length === 0) {
      fallback = db.prepare('SELECT DISTINCT route FROM vehicle_positions').all().map(r => r.route);
    }
    if (fallback.length > 0) {
      log(`Using ${fallback.length} lines from line_endpoints/vehicle_positions as fallback`, 'WARN');
      return fallback;
    }
    return [];
  }

  const insertStmt = db.prepare('INSERT OR REPLACE INTO discovered_lines (line, discovered_at) VALUES (?, ?)');

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM discovered_lines').run();
    for (const line of lines) {
      insertStmt.run(line, nowISO());
    }
    setStaticMeta(db, 'discovered_lines', lines.length);
  });

  transaction();
  log(`Discovered lines: found ${lines.length} lines from .linie-selector`, 'INFO');
  return lines;
}

async function loadStaticData(db) {
  logSection('Static Data Loading');

  await loadStations(db);
  await loadLineEndpoints(db);

  const lines = await discoverAndSaveLines(db);

  if (lines.length > 0) {
    await loadLineConfigs(db, lines);
    await loadLegends(db, lines);
    await loadRoutesGeometry(db, lines);
  }

  logSection('Starting Vehicle Polling');
}

async function refreshStaticDataIfNeeded(db) {
  const stationsMeta = getStaticMeta(db, 'stations');
  const needsRefresh = !stationsMeta || isStale(stationsMeta.last_updated);

  if (needsRefresh) {
    log('Static data stale, refreshing...', 'INFO');
    await loadStaticData(db);
  }
}

function processVehicles(db, vehicles, lastKnown, dryRun = false) {
  let recorded = 0;

  for (const v of vehicles) {
    const vid = v.id;
    if (!vid) continue;

    const lat = v.lat;
    const lng = v.lng;
    const serverTimestamp = v.timestamp;

    const prev = lastKnown.get(vid);
    const isNew = !prev || prev.server_timestamp !== serverTimestamp;

    if (isNew) {
      if (!dryRun) {
        insertPosition(db, v);
        saveLastKnown(db, vid, lat, lng, serverTimestamp);
      }
      lastKnown.set(vid, { lat: Number(lat), lng: Number(lng), server_timestamp: serverTimestamp });
      recorded++;
    }
  }

  return recorded;
}

function getStats(db) {
  try {
    const totalRow = db.prepare('SELECT COUNT(*) as cnt FROM vehicle_positions').get();
    const vehiclesRow = db.prepare('SELECT COUNT(DISTINCT id) as cnt FROM vehicle_positions').get();
    const latestRow = db.prepare('SELECT MAX(recorded_at) as latest FROM vehicle_positions').get();
    return { total: totalRow.cnt, vehicles: vehiclesRow.cnt, latest: latestRow.latest };
  } catch {
    return { total: -1, vehicles: -1, latest: null };
  }
}

function setMeta(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);

}

function getMeta(db, key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

async function runCollector() {
  const dbExists = existsSync(DB_PATH);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  initDB(db);

  if (dbExists) {
    log(`Opened existing database: ${DB_PATH}`, 'INFO');
  } else {
    log(`Created new database: ${DB_PATH}`, 'INFO');
  }

  const lastKnown = loadLastKnown(db);
  log(`Loaded ${lastKnown.size} vehicles from last_known table`, 'INFO');

  setMeta(db, 'started_at', nowISO());

  await loadStaticData(db);

  let pollCount = 0;
  let consecutiveErrors = 0;
  let running = true;

  const signalHandler = (signal) => {
    running = false;
    log(`Received ${signal} — stopping gracefully...`, 'INFO');
  };

  process.on('SIGINT', () => signalHandler('SIGINT'));
  process.on('SIGTERM', () => signalHandler('SIGTERM'));

  log(`Starting poll loop — interval: ${POLL_INTERVAL}s, URL: ${VEHICLES_URL}`, 'INFO');
  log('Press Ctrl+C to stop', 'INFO');
  logSection('Vehicle Polling');

  while (running) {
    pollCount++;

    if (pollCount % STATIC_CHECK_INTERVAL === 0) {
      await refreshStaticDataIfNeeded(db);
    }

    const { vehicles, error } = await fetchVehicles();

    if (error) {
      consecutiveErrors++;
      log(`${error} — retrying in ${POLL_INTERVAL}s (consecutive error #${consecutiveErrors})`, 'ERROR');
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 1000));
      continue;
    }

    consecutiveErrors = 0;

    const stats = getStats(db);
    const recorded = processVehicles(db, vehicles, lastKnown);

    log(
      `${vehicles.length} vehicles fetched | ${recorded} new records | total: ${stats.total} rows (${stats.vehicles} vehicles)`
    );

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 1000));
  }

  logSection('Collector Stopped');
  const finalStats = getStats(db);
  log(`Final stats: ${finalStats.total} rows, ${finalStats.vehicles} distinct vehicles`, 'INFO');
  log(`Database: ${DB_PATH}`, 'INFO');

  db.close();
  process.exit(0);
}

runCollector();

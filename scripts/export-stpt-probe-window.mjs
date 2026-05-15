import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = path.join(__dirname, '../stpt.db');
const OUTPUT_DIR = path.join(__dirname, '../data/traffic-lights/analysis/raw');
const MANIFEST_FILE = path.join(__dirname, '../data/traffic-lights/analysis/export-manifest.json');

const WINDOW_DAYS = ['2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15'];
const PARTITION_ROW_LIMIT = 18000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function query(sql) {
  return execFileSync('sqlite3', ['-header', '-csv', DB_FILE, sql], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }).trim();
}

function parseCsvLine(line) {
  const out = [];
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
      out.push(current);
      current = '';
    } else if (ch === '"') {
      quoted = true;
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function bucketName(route, day, index) {
  return `${day}__${String(route).replace(/[^a-z0-9]+/gi, '_').toLowerCase()}-${String(index).padStart(2, '0')}`;
}

ensureDir(OUTPUT_DIR);
ensureDir(path.dirname(MANIFEST_FILE));

const files = [];

for (const day of WINDOW_DAYS) {
  const routes = query(`
    select route, count(*) as n
    from vehicle_positions
    where substr(recorded_at, 1, 10) = '${day}'
    group by route
    order by n desc, route asc
  `);

  const routeRows = routes
    .split('\n')
    .filter(Boolean)
    .map(parseCsvLine)
    .map(([route, count]) => ({ route, count: Number(count) }))
    .filter((row) => Number.isFinite(row.count) && row.count > 0);

  for (const { route, count } of routeRows) {
    const partitions = Math.max(1, Math.ceil(count / PARTITION_ROW_LIMIT));
    for (let index = 0; index < partitions; index += 1) {
      const offset = index * PARTITION_ROW_LIMIT;
      const limit = PARTITION_ROW_LIMIT;
      const fileName = `${bucketName(route, day, index)}.csv`;
      const outFile = path.join(OUTPUT_DIR, fileName);
      const routeLiteral = `'${String(route).replace(/'/g, "''")}'`;
      const sql = `
        select
          id as vehicle_id,
          route,
          direction_id,
          recorded_at,
          server_timestamp,
          lat,
          lng,
          bearing,
          speed,
          headsign,
          stop_name,
          is_accessible
        from vehicle_positions
        where substr(recorded_at, 1, 10) = '${day}' and route = ${routeLiteral}
        order by server_timestamp asc, id asc
        limit ${limit} offset ${offset};
      `;
      const csv = execFileSync('sqlite3', ['-header', '-csv', DB_FILE, sql], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
      fs.writeFileSync(outFile, csv);
      const stats = fs.statSync(outFile);
      files.push({
        file: `raw/${fileName}`,
        day,
        route,
        partition: index + 1,
        partitionCount: partitions,
        rows: Math.min(limit, Math.max(0, count - offset)),
        bytes: stats.size,
      });
    }
  }
}

const manifest = {
  generatedAt: new Date().toISOString(),
  source: DB_FILE,
  window: { start: WINDOW_DAYS[0], end: WINDOW_DAYS[WINDOW_DAYS.length - 1] },
  partitionRowLimit: PARTITION_ROW_LIMIT,
  files,
};

fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${files.length} CSV slices and ${MANIFEST_FILE}`);

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const provider = process.argv[2] ?? "tomtom";
const outputDir = process.env.TRAFFIC_ROUTES_OUTPUT_DIR ?? "data/traffic-routes";
const dryRun = process.env.TRAFFIC_ROUTES_DRY_RUN === "1" || process.argv.includes("--dry-run");
const usageLimit = Number(
  process.env.TOMTOM_MONTHLY_LIMIT ?? process.env.TRAFFIC_ROUTES_MONTHLY_LIMIT ?? "100",
);
const bbox = (process.env.TRAFFIC_VALIDATION_BBOX ?? "21.19,45.73,21.24,45.77")
  .split(",")
  .map((v) => Number(v.trim()));

const [minLng, minLat, maxLng, maxLat] = bbox;

const timeSlots = [
  { label: "morning-rush", hour: 8, minute: 0 },
  { label: "mid-morning", hour: 10, minute: 0 },
  { label: "midday", hour: 12, minute: 0 },
  { label: "afternoon-rush", hour: 17, minute: 0 },
  { label: "evening", hour: 19, minute: 0 },
  { label: "night", hour: 22, minute: 0 },
];

const routes = [
  { id: "rt-001", name: "Cetate -> Istria", from: { lat: 45.7547, lng: 21.2224 }, to: { lat: 45.7624, lng: 21.2441 } },
  { id: "rt-002", name: "Dometi -> Traian", from: { lat: 45.7452, lng: 21.2108 }, to: { lat: 45.7631, lng: 21.2289 } },
  { id: "rt-003", name: "Fratelia -> Centro", from: { lat: 45.7378, lng: 21.1987 }, to: { lat: 45.7499, lng: 21.2275 } },
  { id: "rt-004", name: "Ghiroda -> Calea Aradului", from: { lat: 45.7698, lng: 21.2124 }, to: { lat: 45.7512, lng: 21.2367 } },
  { id: "rt-005", name: "Zona Industriala -> Centru", from: { lat: 45.7356, lng: 21.2489 }, to: { lat: 45.7567, lng: 21.2245 } },
  { id: "rt-006", name: "Cipiana -> Universitatii", from: { lat: 45.7412, lng: 21.2651 }, to: { lat: 45.7489, lng: 21.2504 } },
  { id: "rt-007", name: "Bucovina -> Iosefin", from: { lat: 45.7612, lng: 21.2034 }, to: { lat: 45.7467, lng: 21.2189 } },
  { id: "rt-008", name: "Modei -> Calea Sagetii", from: { lat: 45.7289, lng: 21.2234 }, to: { lat: 45.7543, lng: 21.2387 } },
];

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "OpenTrafficTM traffic route collector",
      ...headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}\n${body.slice(0, 500)}`);
  }
  return response.json();
}

async function readUsageLedger() {
  const ledgerPath = `${outputDir}/usage-ledger-${provider}.json`;
  try {
    const content = await readFile(ledgerPath, "utf8");
    const parsed = JSON.parse(content);
    return {
      ...parsed,
      transactions: Number(parsed.transactions ?? 0),
    };
  } catch {
    return { transactions: 0 };
  }
}

async function writeUsageLedger(ledger) {
  await writeFile(`${outputDir}/usage-ledger-${provider}.json`, `${JSON.stringify(ledger, null, 2)}\n`);
}

async function assertBudget(required) {
  const ledger = await readUsageLedger();
  const next = ledger.transactions + required;
  if (next > usageLimit) {
    throw new Error(`Usage cap exceeded: ${next}/${usageLimit} transactions`);
  }
  return ledger.transactions;
}

function buildRoutingUrl(apiKey, fromLat, fromLng, toLat, toLng, departAt) {
  const encodedFrom = `${fromLat},${fromLng}`;
  const encodedTo = `${toLat},${toLng}`;
  const url = new URL(
    `https://api.tomtom.com/routing/4/calculateroute/${encodeURIComponent(encodedFrom)}/${encodeURIComponent(encodedTo)}/json`
  );
  url.searchParams.set("key", apiKey);
  url.searchParams.set("routeRepresentation", "polyline");
  url.searchParams.set("traffic", "true");
  url.searchParams.set("travelMode", "car");
  url.searchParams.set("departAt", departAt.toISOString());
  return url;
}

async function queryRoute(apiKey, route, departAt) {
  const url = buildRoutingUrl(apiKey, route.from.lat, route.from.lng, route.to.lat, route.to.lng, departAt);
  const data = await fetchJson(url);

  const routes = data?.routes ?? [];
  const summary = routes[0]?.summary ?? {};
  const legs = routes[0]?.legs ?? [];

  const steps = legs.flatMap((leg) =>
    (leg.points ?? []).map((pt, idx) => ({
      routeId: route.id,
      routeName: route.name,
      legIndex: leg.legIndex ?? 0,
      pointIndex: idx,
      lat: pt.latitude,
      lng: pt.longitude,
    }))
  );

  return {
    routeId: route.id,
    routeName: route.name,
    requestedAt: departAt.toISOString(),
    summary: {
      totalDistanceMeters: summary.lengthInMeters ?? 0,
      totalTravelTimeSeconds: summary.travelTimeInSeconds ?? 0,
      staticTravelTimeSeconds: summary.staticTravelTimeInSeconds ?? 0,
      trafficDelaySeconds: summary.trafficDelayInSeconds ?? 0,
      departureTime: summary.departureTime ?? departAt.toISOString(),
      arrivalTime: summary.arrivalTime ?? null,
    },
    viaPoints: legs.flatMap((leg) =>
      (leg.viaPoints ?? []).map((vp) => ({
        lat: vp.latitude,
        lng: vp.longitude,
        name: vp.name ?? null,
      }))
    ),
    guidance: legs.flatMap((leg) =>
      (leg.points ?? []).map((pt, idx) => ({
        latitude: pt.latitude,
        longitude: pt.longitude,
        instructionIndex: idx,
      }))
    ),
    raw: data,
    transactionCount: 1,
  };
}

function normalizeCongestionLevel(delaySeconds, travelTimeSeconds) {
  if (delaySeconds == null || travelTimeSeconds == null || travelTimeSeconds === 0) return "unknown";
  const ratio = delaySeconds / travelTimeSeconds;
  if (ratio >= 0.5) return "severe";
  if (ratio >= 0.3) return "heavy";
  if (ratio >= 0.1) return "moderate";
  return "low";
}

function flattenSteps(routesData) {
  return routesData.flatMap((rd) => {
    const s = rd.summary;
    return rd.guidance.map((g) => ({
      routeId: rd.routeId,
      routeName: rd.routeName,
      requestedAt: rd.requestedAt,
      lat: g.latitude,
      lng: g.longitude,
      instructionIndex: g.instructionIndex,
      totalDistanceMeters: s.totalDistanceMeters,
      totalTravelTimeSeconds: s.totalTravelTimeSeconds,
      staticTravelTimeSeconds: s.staticTravelTimeSeconds,
      trafficDelaySeconds: s.trafficDelaySeconds,
      congestionLevel: normalizeCongestionLevel(s.trafficDelaySeconds, s.totalTravelTimeSeconds),
      departureTime: s.departureTime,
      arrivalTime: s.arrivalTime,
    }));
  });
}

function flattenSummary(routesData) {
  return routesData.map((rd) => {
    const s = rd.summary;
    return {
      routeId: rd.routeId,
      routeName: rd.routeName,
      requestedAt: rd.requestedAt,
      totalDistanceMeters: s.totalDistanceMeters,
      totalTravelTimeSeconds: s.totalTravelTimeSeconds,
      staticTravelTimeSeconds: s.staticTravelTimeSeconds,
      trafficDelaySeconds: s.trafficDelaySeconds,
      congestionLevel: normalizeCongestionLevel(s.trafficDelaySeconds, s.totalTravelTimeSeconds),
      departureTime: s.departureTime,
      arrivalTime: s.arrivalTime,
      viaPointCount: rd.viaPoints?.length ?? 0,
      guidancePointCount: rd.guidance?.length ?? 0,
    };
  });
}

function toCSV(flattened) {
  if (flattened.length === 0) return "";
  const headers = Object.keys(flattened[0]);
  const rows = flattened.map((obj) =>
    headers.map((h) => {
      const val = obj[h];
      if (val == null) return "";
      if (typeof val === "string" && (val.includes(",") || val.includes('"'))) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return String(val);
    }).join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

async function main() {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) throw new Error("TOMTOM_API_KEY is required");

  await mkdir(`${outputDir}/archive`, { recursive: true });
  await mkdir(`${outputDir}/csv`, { recursive: true });

  const collectedAt = new Date();
  const stamp = collectedAt.toISOString().replaceAll(":", "-").replace(".", "-");

  const totalTransactions = routes.length * timeSlots.length;
  await assertBudget(totalTransactions);

  if (dryRun) {
    const ledger = await readUsageLedger();
    console.log(
      `Dry run: would use ${totalTransactions} transactions (current: ${ledger.transactions}/${usageLimit})`
    );
    return;
  }

  const results = [];
  let transactionsUsed = 0;

  for (const slot of timeSlots) {
    const [year, month, day] = collectedAt.toISOString().slice(0, 10).split("-");
    const departAt = new Date(Number(year), Number(month) - 1, Number(day), slot.hour, slot.minute, 0, 0);

    for (const route of routes) {
      const existing = results.find(
        (r) => r.routeId === route.id && r.requestedAt === departAt.toISOString()
      );
      if (existing) continue;

      try {
        const routeResult = await queryRoute(apiKey, route, departAt);
        results.push(routeResult);
        transactionsUsed++;

        const used = await assertBudget(0);
        await writeUsageLedger({
          transactions: used + transactionsUsed,
          updatedAt: new Date().toISOString(),
          limit: usageLimit,
        });

        console.log(
          `[${transactionsUsed}/${totalTransactions}] ${route.id} @ ${slot.label}: ` +
            `${(routeResult.summary.totalTravelTimeSeconds / 60).toFixed(1)}min, ` +
            `+${routeResult.summary.trafficDelaySeconds}s delay`
        );
      } catch (err) {
        console.error(`Failed ${route.id} @ ${slot.label}: ${err.message}`);
      }
    }
  }

  const summaryData = flattenSummary(results);
  const stepsData = flattenSteps(results);

  const jsonOut = {
    provider: "tomtom-routing",
    collectedAt: collectedAt.toISOString(),
    timeSlots: timeSlots.map((s) => ({ ...s, date: collectedAt.toISOString().slice(0, 10) })),
    routeCount: routes.length,
    transactionCount: transactionsUsed,
    summary: summaryData,
  };

  const archivePath = `${outputDir}/archive/${provider}-${stamp}.json`;
  const latestPath = `${outputDir}/${provider}-latest.json`;
  const summaryCsvPath = `${outputDir}/csv/${provider}-summary-${stamp}.csv`;
  const stepsCsvPath = `${outputDir}/csv/${provider}-steps-${stamp}.csv`;

  await writeFile(archivePath, `${JSON.stringify(jsonOut, null, 2)}\n`);
  await writeFile(latestPath, `${JSON.stringify(jsonOut, null, 2)}\n`);
  await writeFile(summaryCsvPath, toCSV(summaryData));
  await writeFile(stepsCsvPath, toCSV(stepsData));

  await writeUsageLedger({
    transactions: (await readUsageLedger()).transactions + transactionsUsed,
    updatedAt: collectedAt.toISOString(),
    limit: usageLimit,
  });

  console.log(
    `\nDone. Collected ${results.length} routes across ${timeSlots.length} time slots. ` +
      `Outputs: ${archivePath}, ${summaryCsvPath}, ${stepsCsvPath}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
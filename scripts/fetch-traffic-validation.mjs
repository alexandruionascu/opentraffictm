import { mkdir, readFile, writeFile } from "node:fs/promises";

const provider = process.argv[2];
const outputDir = process.env.TRAFFIC_VALIDATION_OUTPUT_DIR ?? "data/traffic-validation";
const dryRun = process.env.TRAFFIC_VALIDATION_DRY_RUN === "1" || process.argv.includes("--dry-run");
const usageLimitMonthlyTransactions = Number(
  provider === "here"
    ? process.env.HERE_MONTHLY_LIMIT ?? process.env.TRAFFIC_VALIDATION_MONTHLY_LIMIT ?? "20"
    : process.env.TOMTOM_MONTHLY_LIMIT ?? process.env.TRAFFIC_VALIDATION_MONTHLY_LIMIT ?? "20",
);
const usageLimitDailyTransactions = Number(
  provider === "tomtom"
    ? process.env.TOMTOM_DAILY_LIMIT ?? "2500"
    : process.env.HERE_DAILY_LIMIT ?? "2500",
);
const bbox = (process.env.TRAFFIC_VALIDATION_BBOX ?? "21.19,45.73,21.24,45.77")
  .split(",")
  .map((value) => Number(value.trim()));

if (!provider || !["here", "tomtom"].includes(provider)) {
  console.error("Usage: node scripts/fetch-traffic-validation.mjs <here|tomtom>");
  process.exit(1);
}

if (bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value))) {
  throw new Error("TRAFFIC_VALIDATION_BBOX must be four comma-separated numbers: minLng,minLat,maxLng,maxLat");
}

const [minLng, minLat, maxLng, maxLat] = bbox;
const collectedAt = new Date();
const stamp = collectedAt.toISOString().replaceAll(":", "-").replace(".", "-");
const requestId = `${provider}-${stamp}`;

function bboxCenter() {
  return {
    lng: (minLng + maxLng) / 2,
    lat: (minLat + maxLat) / 2,
  };
}

function buildSamplePoints() {
  const lngStep = (maxLng - minLng) / 3;
  const latStep = (maxLat - minLat) / 3;
  return [
    [minLat + latStep, minLng + lngStep],
    [minLat + latStep, minLng + 2 * lngStep],
    [minLat + 2 * latStep, minLng + lngStep],
    [minLat + 2 * latStep, minLng + 2 * lngStep],
    [minLat + latStep / 2, minLng + 1.5 * lngStep],
    [minLat + 2.5 * latStep, minLng + 1.5 * lngStep],
  ];
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "OpenTrafficTM traffic validation collector",
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
      monthlyTransactions: Number(parsed.monthlyTransactions ?? 0),
      dailyTransactions: Number(parsed.dailyTransactions ?? 0),
      monthKey: String(parsed.monthKey ?? ""),
      dayKey: String(parsed.dayKey ?? ""),
    };
  } catch {
    return {
      monthKey: new Date().toISOString().slice(0, 7),
      dayKey: new Date().toISOString().slice(0, 10),
      monthlyTransactions: 0,
      dailyTransactions: 0,
    };
  }
}

async function writeUsageLedger(ledger) {
  await writeFile(`${outputDir}/usage-ledger-${provider}.json`, `${JSON.stringify(ledger, null, 2)}\n`);
}

async function assertBudget(requiredTransactions) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentDay = new Date().toISOString().slice(0, 10);
  const ledger = await readUsageLedger();
  const monthKey = ledger.monthKey === currentMonth ? ledger.monthKey : currentMonth;
  const dayKey = ledger.dayKey === currentDay ? ledger.dayKey : currentDay;
  const current = ledger.monthKey === currentMonth ? ledger.monthlyTransactions : 0;
  const dailyCurrent = ledger.dayKey === currentDay ? ledger.dailyTransactions : 0;
  const nextTotal = current + requiredTransactions;
  const nextDailyTotal = dailyCurrent + requiredTransactions;

  if (nextTotal > usageLimitMonthlyTransactions) {
    throw new Error(
      `Usage cap exceeded for ${monthKey}: ${nextTotal}/${usageLimitMonthlyTransactions} transactions would be used.`,
    );
  }

  if (nextDailyTotal > usageLimitDailyTransactions) {
    throw new Error(
      `Daily cap exceeded for ${dayKey}: ${nextDailyTotal}/${usageLimitDailyTransactions} transactions would be used.`,
    );
  }

  return { monthKey, dayKey, current, dailyCurrent, nextTotal, nextDailyTotal };
}

function normalizeHereFlow(items) {
  return items.map((item, index) => ({
    segmentId: item?.location?.description ?? item?.location?.shape ?? `here-flow-${index}`,
    roadName: item?.location?.description ?? undefined,
    geometry: item?.location?.shape?.polyline
      ? [[minLng, minLat], [maxLng, maxLat]]
      : [[minLng, minLat], [maxLng, maxLat]],
    speedKph: item?.currentFlow?.speed ?? undefined,
    travelTimeSeconds: item?.currentFlow?.traversability?.length ?? undefined,
    delaySeconds: item?.currentFlow?.jamFactor ?? undefined,
    congestionLevel:
      typeof item?.currentFlow?.jamFactor === "number"
        ? item.currentFlow.jamFactor >= 8
          ? "severe"
          : item.currentFlow.jamFactor >= 6
            ? "heavy"
            : item.currentFlow.jamFactor >= 3
              ? "moderate"
              : "low"
        : undefined,
    confidence: 0.8,
  }));
}

function normalizeTomTomFlow(response, label) {
  const flow = response?.flowSegmentData ?? response?.flowSegmentData?.currentFlow ?? response;
  const current = flow?.currentFlow ?? {};
  const freeFlow = flow?.freeFlowSpeed ?? current?.freeFlowSpeed;
  const currentSpeed = current?.speed ?? flow?.currentSpeed;

  const coords = flow?.coordinates;
  let geometry;
  if (coords) {
    if (Array.isArray(coords.coordinate)) {
      const pts = coords.coordinate;
      geometry = pts.map((pt) => [pt.longitude ?? pt.lng ?? 0, pt.latitude ?? pt.lat ?? 0]);
    } else if (coords.longitude != null || coords.lng != null) {
      geometry = [[coords.longitude ?? coords.lng, coords.latitude ?? coords.lat]];
    } else {
      geometry = [[minLng, minLat], [maxLng, maxLat]];
    }
  } else {
    geometry = [[minLng, minLat], [maxLng, maxLat]];
  }

  return [
    {
      segmentId: flow?.location?.description ?? label ?? "tomtom-flow-0",
      roadName: flow?.roadName ?? flow?.location?.description ?? undefined,
      geometry,
      speedKph: currentSpeed,
      travelTimeSeconds: flow?.currentTravelTime ?? undefined,
      delaySeconds:
        typeof currentSpeed === "number" && typeof freeFlow === "number" ? Math.max(0, freeFlow - currentSpeed) : undefined,
      congestionLevel:
        typeof currentSpeed === "number" && typeof freeFlow === "number"
          ? currentSpeed < freeFlow * 0.4
            ? "severe"
            : currentSpeed < freeFlow * 0.7
              ? "heavy"
              : currentSpeed < freeFlow * 0.9
                ? "moderate"
                : "low"
          : undefined,
      confidence: flow?.confidence ?? 0.8,
    },
  ];
}

async function runHere() {
  const apiKey = process.env.HERE_API_KEY;
  if (!apiKey) throw new Error("HERE_API_KEY is required");

  const center = bboxCenter();
  const flowUrl = new URL("https://data.traffic.hereapi.com/v7/flow");
  flowUrl.searchParams.set("apiKey", apiKey);
  flowUrl.searchParams.set("in", `bbox:${minLng},${minLat},${maxLng},${maxLat}`);
  flowUrl.searchParams.set("locationReferencing", "shape");

  const incidentsUrl = new URL("https://data.traffic.hereapi.com/v7/incidents");
  incidentsUrl.searchParams.set("apiKey", apiKey);
  incidentsUrl.searchParams.set("in", `bbox:${minLng},${minLat},${maxLng},${maxLat}`);
  incidentsUrl.searchParams.set("locationReferencing", "shape");

  const [flow, incidents] = await Promise.all([fetchJson(flowUrl), fetchJson(incidentsUrl)]);
  const flowItems = flow?.results ?? flow?.flows ?? flow?.items ?? [];
  const incidentItems = incidents?.results ?? incidents?.incidents ?? incidents?.items ?? [];

  return {
    provider: "here",
    requestId,
    requestedAt: collectedAt.toISOString(),
    windowStart: new Date(collectedAt.getTime() - 15 * 60 * 1000).toISOString(),
    windowEnd: collectedAt.toISOString(),
    bbox,
    corridor: "Timișoara validation corridor",
    mode: "traffic",
    segments: normalizeHereFlow(flowItems),
    incidents: incidentItems.map((item, index) => ({
      incidentId: item?.incidentId ?? item?.id ?? `here-incident-${index}`,
      kind: item?.kind ?? item?.type ?? "incident",
      description: item?.description ?? item?.eventDescription ?? undefined,
      severity: item?.severity ?? item?.criticality ?? undefined,
      geometry: item?.location?.shape?.polyline ? [[center.lng, center.lat]] : undefined,
    })),
    rawStored: true,
    raw: { flow, incidents },
    transactionCount: 2,
  };
}

async function runTomTom() {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) throw new Error("TOMTOM_API_KEY is required");

  const center = bboxCenter();
  const samplePoints = buildSamplePoints();

  const incidentsUrl = new URL("https://api.tomtom.com/traffic/services/5/incidentDetails");
  incidentsUrl.searchParams.set("key", apiKey);
  incidentsUrl.searchParams.set("bbox", `${minLng},${minLat},${maxLng},${maxLat}`);
  incidentsUrl.searchParams.set("fields", "{incidents{type,geometry{type,coordinates},properties{iconCategory}}}");
  incidentsUrl.searchParams.set("language", "en-GB");
  incidentsUrl.searchParams.set("timeValidityFilter", "present");

  const flowItems = [];
  for (const [index, [lat, lng]] of samplePoints.entries()) {
    const flowUrl = new URL("https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json");
    flowUrl.searchParams.set("key", apiKey);
    flowUrl.searchParams.set("point", `${lat},${lng}`);
    flowUrl.searchParams.set("unit", "KMPH");
    flowUrl.searchParams.set("thickness", "10");
    flowUrl.searchParams.set("openLr", "false");
    const flow = await fetchJson(flowUrl);
    flowItems.push(...normalizeTomTomFlow(flow, `sample-${index + 1}`));
  }

  const incidents = await fetchJson(incidentsUrl);
  const incidentsItems = incidents?.incidents ?? incidents?.results ?? [];

  function extractCoordinates(geom) {
    if (!geom) return null;
    if (geom.type === "LineString" && Array.isArray(geom.coordinates)) {
      return geom.coordinates;
    }
    if (geom.type === "Point" && Array.isArray(geom.coordinates)) {
      return geom.coordinates;
    }
    return null;
  }

  function parseIncidentCoords(item) {
    const rawCoords = item?.geometry?.coordinates;
    if (!rawCoords) return { lat: null, lng: null };
    if (Array.isArray(rawCoords) && rawCoords.length > 0) {
      if (Array.isArray(rawCoords[0])) {
        const first = rawCoords[0];
        return { lng: first[0] ?? null, lat: first[1] ?? null };
      } else {
        return { lng: rawCoords[0] ?? null, lat: rawCoords[1] ?? null };
      }
    }
    return { lat: null, lng: null };
  }

  return {
    provider: "tomtom",
    requestId,
    requestedAt: collectedAt.toISOString(),
    windowStart: new Date(collectedAt.getTime() - 15 * 60 * 1000).toISOString(),
    windowEnd: collectedAt.toISOString(),
    bbox,
    corridor: "Timișoara validation corridor",
    mode: "traffic",
    segments: flowItems,
    incidents: incidentsItems.map((item, index) => {
      const { lng, lat } = parseIncidentCoords(item);
      return {
        incidentId: item?.id ?? item?.properties?.iconCategory ?? `tomtom-incident-${index}`,
        kind: item?.properties?.iconCategory ?? item?.type ?? "incident",
        description: item?.properties?.description ?? undefined,
        severity: item?.properties?.magnitudeOfDelay ?? undefined,
        geometry: extractCoordinates(item?.geometry) ?? undefined,
        lat,
        lng,
      };
    }),
    rawStored: true,
    raw: { incidents },
    transactionCount: samplePoints.length + 1,
  };
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(`${outputDir}/providers/${provider}`, { recursive: true });
  await mkdir(`${outputDir}/providers/${provider}/archive`, { recursive: true });

  const transactionCount = 2;
  const budget = await assertBudget(transactionCount);
  if (dryRun) {
    console.log(
      `Dry run: ${provider} would use ${transactionCount} transaction(s); remaining budget after run would be ${usageLimitMonthlyTransactions - budget.nextTotal} monthly and ${usageLimitDailyTransactions - budget.nextDailyTotal} daily.`,
    );
    return;
  }
  const snapshot = provider === "here" ? await runHere() : await runTomTom();
  const manifestPath = `${outputDir}/providers/${provider}/latest.json`;
  const archivePath = `${outputDir}/providers/${provider}/archive/${stamp}.json`;
  const derivedPath = `${outputDir}/derived/${provider}-${stamp}.json`;

  await mkdir(`${outputDir}/derived`, { recursive: true });

  await writeFile(manifestPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFile(archivePath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFile(
    derivedPath,
    `${JSON.stringify(
      {
        provider,
        requestId,
        collectedAt: collectedAt.toISOString(),
        bbox,
        transactionCount,
        segmentCount: snapshot.segments.length,
        incidentCount: snapshot.incidents.length,
        notes: "Derived validation summary from private traffic API data.",
      },
      null,
      2,
    )}\n`,
  );
  await writeUsageLedger({
    monthKey: budget.monthKey,
    monthlyTransactions: budget.nextTotal,
    dayKey: budget.dayKey,
    dailyTransactions: budget.nextDailyTotal,
    updatedAt: collectedAt.toISOString(),
    limit: usageLimitMonthlyTransactions,
    dailyLimit: usageLimitDailyTransactions,
  });

  console.log(
    `Collected ${provider} validation snapshot with ${snapshot.segments.length} segments and ${snapshot.incidents.length} incidents.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { mkdir, readFile, writeFile } from "node:fs/promises";

const outputDir = process.env.TIMISOARA_ROAD_CLOSURES_OUTPUT_DIR ?? "data/sources/timisoara-road-closures";
const baseUrl = process.env.TIMISOARA_ROAD_CLOSURES_BASE_URL ?? "https://www.primariatm.ro";
const seedFile = process.env.TIMISOARA_ROAD_CLOSURES_SEED_FILE ?? `${outputDir}/seed-urls.json`;
const extraUrls = (process.env.TIMISOARA_ROAD_CLOSURES_URLS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const defaultSeedUrls = [
  "/2026/05/07/restrictii-rutiere",
  "/2026/05/04/restrictii-circulatie",
  "/2026/04/30/restrictii-circulatie",
  "/2026/04/24/arena-eroii-timisoarei",
  "/2026/04/15/restrictii-rutiere",
  "/2026/04/07/restrictii-circulatie",
  "/2026/04/03/restrictii-circulatie",
  "/2026/03/25/restrictii-de-circulatie",
  "/2026/03/12/restrictii-rutiere",
  "/2026/02/13/restrictii",
  "/2026/02/06/restrictii",
  "/2026/01/30/restrictii-circulatie",
  "/2026/01/28/restrictii-circulatie",
  "/2025/12/12/restrictii-circulatie",
  "/2025/12/11/inchidere-rutiera",
  "/2025/12/02/restrictii-circulatie",
  "/2025/11/07/restrictii-circulatie",
  "/2025/10/15/inchideri-circulatie",
  "/2025/09/26/inchideri-circulatie",
  "/2024/03/15/restrictii-rutiere",
];

function toAbsoluteUrl(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return new URL(pathOrUrl, `${baseUrl}/`).toString();
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1] ?? match[0];
  }
  return null;
}

function normalizeWhitespace(text) {
  return text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

function parsePublishedDate(html, fallbackUrl) {
  const fromMeta = firstMatch(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']date["'][^>]*content=["']([^"']+)["']/i,
  ]);
  if (fromMeta) {
    const parsed = new Date(fromMeta);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const urlMatch = fallbackUrl.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  if (urlMatch) {
    const [, year, month, day] = urlMatch;
    const parsed = new Date(`${year}-${month}-${day}T00:00:00+02:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return null;
}

function extractTitle(html, url) {
  const title =
    firstMatch(html, [
      /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]) ?? url;
  return normalizeWhitespace(stripTags(title));
}

function textFromHtml(html) {
  return normalizeWhitespace(stripTags(html));
}

function extractBodyText(html) {
  const articleMatch =
    html.match(/<article[\s\S]*?<\/article>/i) ??
    html.match(/<main[\s\S]*?<\/main>/i) ??
    html.match(/<body[\s\S]*?<\/body>/i);
  const source = articleMatch ? articleMatch[0] : html;
  return textFromHtml(source);
}

function summarizeClosure(text) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const highlights = sentences.filter((sentence) =>
    /restric|înch|trafic|bandă|banda|ocol|deviat|sens unic|noapte|noaptea/i.test(sentence),
  );

  return highlights.length ? highlights.slice(0, 6) : sentences.slice(0, 4);
}

function extractRoadMentions(text) {
  const patterns = [
    /(?:pe|pe traseul|pe tronsonul|pe tronson|în zona)\s+(?:strada|străzile|bulevardul|bulevardele|podul|splaiul|calea|str\.)\s+([^.;:]+)/gi,
    /(?:pe|pe traseul|pe tronsonul|pe tronson|în zona)\s+(?:bd\.|b-dul)\s+([^.;:]+)/gi,
  ];

  const seen = new Set();
  const roads = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const raw = match[1]
        .split(/,| și | si | \/ |;| - /i)[0]
        .replace(/\b(va fi|vor fi|este|sunt|închis(?:ă)?|închise|restricționat(?:ă)?|restricționate|restricționată|restricționate|pe|pentru|în vederea|în intervalul|pe timp de noapte|pe timp de zi)\b.*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!raw) continue;
      const cleaned = raw
        .replace(/^(de la|din|între|intre|tronsonul cuprins între|tronsonul cuprins intre)\s+/i, "")
        .trim();
      if (!cleaned) continue;
      if (cleaned.length < 3) continue;
      if (/\b(?:trafic|circula|restric|înch|lucră|lucrărilor|zona|intersec)\b/i.test(cleaned)) continue;
      const key = cleaned.toLocaleLowerCase("ro");
      if (seen.has(key)) continue;
      seen.add(key);
      roads.push(cleaned);
    }
  }

  return roads;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "OpenTrafficTM road closure collector",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  }

  return response.text();
}

async function loadSeedUrls() {
  try {
    const content = await readFile(seedFile, "utf8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean);
    }
  } catch {
    // Fall back to the baked-in list.
  }

  return defaultSeedUrls;
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(`${outputDir}/archive`, { recursive: true });
  await mkdir(`${outputDir}/pages`, { recursive: true });

  const seededUrls = await loadSeedUrls();
  const urls = [...new Set([...seededUrls, ...extraUrls].map(toAbsoluteUrl))].sort((a, b) => a.localeCompare(b));
  const collectedAt = new Date();
  const stamp = collectedAt.toISOString().replaceAll(":", "-").replace(".", "-");
  const records = [];
  const failures = [];

  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const title = extractTitle(html, url);
      const text = extractBodyText(html);
      const publishedAt = parsePublishedDate(html, url);
      const closure = {
        url,
        title,
        publishedAt,
        source: "Primăria Municipiului Timișoara",
        text,
        highlights: summarizeClosure(text),
        roads: extractRoadMentions(text),
        keptLocal: true,
      };

      const slug = url
        .replace(/^https?:\/\//i, "")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
      await writeFile(`${outputDir}/pages/${slug}.html`, html);
      records.push(closure);
    } catch (error) {
      failures.push({
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const normalized = records.sort((a, b) => {
    const left = a.publishedAt ?? a.title;
    const right = b.publishedAt ?? b.title;
    return String(right).localeCompare(String(left));
  });

  const latest = {
    collectedAt: collectedAt.toISOString(),
    source: baseUrl,
    sourceType: "official municipal notices",
    retainedLocally: true,
    recordCount: normalized.length,
    failures,
    records: normalized,
  };

  await writeFile(`${outputDir}/latest.json`, `${JSON.stringify(latest, null, 2)}\n`);
  await writeFile(`${outputDir}/archive/${stamp}.json`, `${JSON.stringify(latest, null, 2)}\n`);
  await writeFile(
    `${outputDir}/manifest.json`,
    `${JSON.stringify(
      {
        generatedAt: collectedAt.toISOString(),
        baseUrl,
        seedFile,
        seedCount: seededUrls.length,
        outputFile: `${outputDir}/latest.json`,
        archiveDir: `${outputDir}/archive`,
        pageDir: `${outputDir}/pages`,
        sourceType: "official municipal closures notices",
        localOnly: true,
        caveat:
          "This mirrors official Timișoara notices about closures and restrictions. It is not Google Maps data and should be refreshed from the municipal source, not redistributed as live navigation data.",
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Fetched ${normalized.length} road-closure notices into ${outputDir}.`);
  if (failures.length) {
    console.log(`Skipped ${failures.length} notices that could not be fetched.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

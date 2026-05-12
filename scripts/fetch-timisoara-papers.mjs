import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const outputDir = process.env.PAPERS_OUTPUT_DIR ?? "data/papers";
const filesDir = `${outputDir}/files`;
const seedFile = process.env.PAPERS_SEED_FILE ?? `${outputDir}/seeds.json`;

const defaultSeeds = [
  {
    id: "hybrid-kalman-fuzzy-car-following",
    title: "Hybrid Solution Combining Kalman Filtering with Takagi-Sugeno Fuzzy Inference System for Online Car-Following Model Calibration",
    year: 2020,
    authors: ["Mădălin-Dorin Pop", "Octavian Proștean", "Tudor-Mihai David", "Gabriela Proștean"],
    venue: "Sensors",
    doi: "10.3390/s20195539",
    sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7582673/",
    pdfUrl: "https://pdfs.semanticscholar.org/f53b/68d85e22bc89fc1a2ec08e0788714e316610.pdf",
    access: "open",
    category: "calibration",
    relevance:
      "Timisoara traffic-monitoring data were used to calibrate car-following parameters in real time.",
  },
  {
    id: "timisoara-traffic-light-control-sensors",
    title: "Ensemble based traffic light control for city zones using a reduced number of sensors",
    year: 2014,
    authors: ["unknown"],
    venue: "Transportation Research Part C",
    doi: "10.1016/j.trc.2014.06.006",
    sourceUrl: "https://www.sciencedirect.com/science/article/pii/S0968090X14001855",
    access: "restricted",
    category: "signal-control",
    relevance:
      "Timisoara central-area case study for adaptive signal control and reduced sensor placement.",
  },
  {
    id: "timisoara-congestion-routes-information",
    title: "Urban traffic congestion prediction based on routes information",
    year: 2013,
    authors: ["Pescaru Dan"],
    venue: "IEEE SACI 2013",
    doi: "10.1109/SACI.2013.6608951",
    sourceUrl: "https://ieeexplore.ieee.org/document/6608951",
    access: "restricted",
    category: "prediction",
    relevance:
      "Timisoara case study using event-based routes and sensor-network inputs for congestion prediction.",
  },
  {
    id: "timisoara-public-traffic-flow-dataset",
    title: "A dataset of urban traffic flow for 13 Romanian cities amid lockdown and after ease of COVID19 related restrictions",
    year: 2020,
    authors: ["Alexandru Iovanovici", "Dacian Avramoni", "Lucian Prodan"],
    venue: "Data in Brief",
    doi: "10.1016/j.dib.2020.106318",
    sourceUrl: "https://www.sciencedirect.com/science/article/pii/S2352340920312129",
    pdfUrl: "https://www.sciencedirect.com/science/article/pii/S2352340920312129/pdfft?isDTMRedir=true&download=true",
    access: "open",
    category: "probe-data",
    relevance:
      "Public traffic-flow traces include Timisoara and provide a reusable short-term congestion benchmark.",
  },
  {
    id: "timisoara-student-complex-road-infrastructure",
    title: "Analysis of the problems related to traffic and road infrastructure in the area of the Timisoara student complex",
    year: 2024,
    authors: ["Madalina Ileana Zot", "Ovidiu-Octavian Maran", "Mihaela Popa", "Francisc Popescu", "Luisa Izabel Dungan"],
    venue: "Reciklaža i Održivi Razvoj",
    doi: "10.5937/ror2401057Z",
    sourceUrl: "https://www.rsd.tfbor.bg.ac.rs/index.php/home/article/view/101",
    pdfUrl: "https://scindeks-clanci.ceon.rs/data/pdf/1820-7480/2024/1820-74802401057Z.pdf",
    access: "open",
    category: "road-infrastructure",
    relevance:
      "District-level traffic and road-infrastructure analysis for the Timisoara student complex.",
  },
  {
    id: "timisoara-city-monitoring-car-following",
    title: "Short term traffic congestion prediction using publically available traffic data: a case study on Timisoara",
    year: 2022,
    authors: ["Dacian Avramoni", "Alexandru Iovanovici", "Anca Ilienescu", "Lucian Prodan"],
    venue: "IEEE conference paper",
    doi: null,
    sourceUrl: "https://ieeexplore.ieee.org/document/9780813/",
    access: "restricted",
    category: "prediction",
    relevance:
      "Short-term congestion prediction using publicly available traffic data for Timisoara.",
  },
  {
    id: "timisoara-air-quality-traffic-intensity",
    title: "A Study on Particulate Matter from an Area with High Traffic Intensity",
    year: 2023,
    authors: ["Dan-Marius Mustață", "Ioana Ionel", "Rareș-Mihăiță Popa", "Ciprian Dughir", "Daniel Bisorca"],
    venue: "Applied Sciences",
    doi: "10.3390/app13158824",
    sourceUrl: "https://www.mdpi.com/2076-3417/13/15/8824",
    pdfUrl: "https://www.mdpi.com/2076-3417/13/15/8824/pdf",
    access: "open",
    category: "impact",
    relevance:
      "Roadside traffic intensity evidence that can support demand and emissions assumptions around busy corridors.",
  },
  {
    id: "timisoara-tactics-adaptive-control",
    title: "TACTICS: Adaptive Framework for Reactive Control of Road Traffic Systems",
    year: 2015,
    authors: ["Cristian Cosariu", "Alexandru Iovanovici", "Lucian Prodan", "Mircea Vladutiu"],
    venue: "Scientific Bulletin of Politehnica University of Timisoara",
    sourceUrl: "https://dspace.upt.ro/xmlui/handle/123456789/1155",
    pdfUrl: "https://dspace.upt.ro/xmlui/bitstream/handle/123456789/1155/BUPT_ART_Cosariu_f.pdf?isAllowed=y&sequence=3",
    access: "open",
    category: "signal-control",
    relevance:
      "Timisoara case study for adaptive reactive traffic control, queue reduction, and waiting-time improvement.",
  },
];

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function loadSeeds() {
  try {
    const json = JSON.parse(await readFile(seedFile, "utf8"));
    if (Array.isArray(json) && json.length > 0) {
      return json;
    }
  } catch {
    // fall back to the built-in seed list
  }

  return defaultSeeds;
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
      "user-agent": "OpenTrafficTM paper collector",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  }

  return {
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    arrayBuffer: await response.arrayBuffer(),
  };
}

function curlBuffer(url) {
  return execFileSync("curl", ["-L", "--fail", "--silent", "--show-error", url], {
    maxBuffer: 50 * 1024 * 1024,
  });
}

async function downloadBinary(url) {
  try {
    return await fetchBuffer(url);
  } catch {
    const buffer = curlBuffer(url);
    return {
      contentType: "application/pdf",
      arrayBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "OpenTrafficTM paper collector",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  }

  return response.text();
}

function extractPdfCandidates(html, baseUrl) {
  const urls = new Set();
  const pattern = /href\s*=\s*["']([^"']+\.pdf[^"']*)["']/gi;

  for (const match of html.matchAll(pattern)) {
    try {
      urls.add(new URL(match[1], baseUrl).toString());
    } catch {
      // ignore invalid URLs
    }
  }

  return [...urls];
}

async function attemptDownloadPdf(seed) {
  const filename = `${slugify(seed.id)}.pdf`;
  const filePath = `${filesDir}/${filename}`;
  await unlink(filePath).catch(() => {});

  if (seed.pdfUrl) {
    try {
      const pdf = await downloadBinary(seed.pdfUrl);
      await writeFile(filePath, Buffer.from(pdf.arrayBuffer));
      return {
        status: "downloaded",
        filePath,
        sourceUrl: seed.pdfUrl,
        contentType: pdf.contentType,
      };
    } catch {
      // fall through to source page probing
    }
  }

  if (seed.sourceUrl) {
    try {
      const html = await fetchText(seed.sourceUrl);
      const candidates = extractPdfCandidates(html, seed.sourceUrl);
      for (const pdfUrl of candidates) {
        try {
          const pdf = await downloadBinary(pdfUrl);
          await writeFile(filePath, Buffer.from(pdf.arrayBuffer));
          return {
            status: "downloaded",
            filePath,
            sourceUrl: pdfUrl,
            contentType: pdf.contentType,
          };
        } catch {
          // try next candidate
        }
      }
    } catch {
      // source page was not accessible
    }
  }

  return {
    status: "unavailable",
  };
}

async function main() {
  const seeds = await loadSeeds();
  await mkdir(outputDir, { recursive: true });
  await mkdir(filesDir, { recursive: true });

  const papers = [];
  for (const seed of seeds) {
    const download = await attemptDownloadPdf(seed);
    papers.push({
      id: seed.id,
      title: seed.title,
      year: seed.year,
      authors: seed.authors ?? [],
      venue: seed.venue ?? null,
      doi: seed.doi ?? null,
      sourceUrl: seed.sourceUrl ?? null,
      pdfUrl: seed.pdfUrl ?? null,
      access: seed.access ?? "unknown",
      category: seed.category ?? "general",
      relevance: seed.relevance ?? "",
      download,
    });
  }

  const openCount = papers.filter((paper) => paper.access === "open").length;
  const downloadedCount = papers.filter((paper) => paper.download.status === "downloaded").length;
  const allowedFiles = new Set(
    papers
      .filter((paper) => paper.download.status === "downloaded" && paper.download.filePath)
      .map((paper) => paper.download.filePath.split("/").pop()),
  );

  for (const fileName of await readdir(filesDir)) {
    if (!allowedFiles.has(fileName)) {
      await unlink(`${filesDir}/${fileName}`).catch(() => {});
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    scope: "Timisoara-first",
    counts: {
      total: papers.length,
      openAccess: openCount,
      downloaded: downloadedCount,
      metadataOnly: papers.length - downloadedCount,
    },
    papers,
  };

  await writeFile(`${outputDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Wrote ${papers.length} paper records to ${outputDir}.`);
  console.log(`Downloaded ${downloadedCount} accessible PDFs.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

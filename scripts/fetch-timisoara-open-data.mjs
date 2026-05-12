import { mkdir, writeFile } from "node:fs/promises";

const outputDir = "data/sources/timisoara-open-data";
const packageSearchUrl =
  "https://data.primariatm.ro/api/3/action/package_search?fq=groups:mobilitate&rows=20";

const resources = [
  {
    id: "transportul-public",
    file: "transportul-public.csv",
    url: "https://data.primariatm.ro/dataset/8d8f9163-2b3a-41c4-9f2b-e939268a8c91/resource/cccf1959-4bb7-40cd-a817-91a885d06609/download/transportul-public.csv",
  },
  {
    id: "transportul-public-normat",
    file: "transportul-public-normat.csv",
    url: "https://data.primariatm.ro/dataset/8d8f9163-2b3a-41c4-9f2b-e939268a8c91/resource/380ff810-5d40-4196-aad8-74b3757fabcc/download/transportul-public.csv",
  },
  {
    id: "sistemul-de-biciclete-trotinete-normat",
    file: "sistemul-de-biciclete-trotinete-normat.csv",
    url: "https://data.primariatm.ro/dataset/0b9cba8f-82f2-4b52-9f66-d17cf61c720e/resource/7681392b-01cc-480e-b99c-4aeb6bcb2c08/download/sistemul-de-biciclete-trotinete.csv",
  },
  {
    id: "infrastructura-rutiera-normat",
    file: "infrastructura-rutiera-normat.csv",
    url: "https://data.primariatm.ro/dataset/f99aeec0-e850-47cb-9bd9-6903369b479e/resource/94b66632-258b-4c5b-a92d-27758d1d7057/download/infrastructura-rutiera.csv",
  },
  {
    id: "sistem-feroviar-transport-feroviar-normat",
    file: "sistem-feroviar-transport-feroviar-normat.csv",
    url: "https://data.primariatm.ro/dataset/961814e6-3bd3-4508-98ff-cc67eb1137b6/resource/0df8b837-31e4-44d1-86b0-beaae0da1ad8/download/sistem-feroviar-transport-feroviar.csv",
  },
];

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "OpenTrafficTM data fetcher",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  }

  return response.text();
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const catalog = await fetchText(packageSearchUrl);
  await writeFile(`${outputDir}/ckan-mobilitate-package-search.json`, catalog);

  const fetched = [];
  for (const resource of resources) {
    const body = await fetchText(resource.url);
    await writeFile(`${outputDir}/${resource.file}`, body);
    fetched.push({
      id: resource.id,
      file: `${outputDir}/${resource.file}`,
      sourceUrl: resource.url,
      bytes: Buffer.byteLength(body),
    });
  }

  await writeFile(
    `${outputDir}/manifest.json`,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        catalogUrl: packageSearchUrl,
        license: "Creative Commons Attribution, per Timișoara open-data portal package metadata",
        fetched,
        caveat:
          "These are annual aggregate mobility and infrastructure indicators. They are not live road-traffic counts, speeds, signal phases, or probe traces.",
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Fetched ${fetched.length} Timișoara open-data resources into ${outputDir}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

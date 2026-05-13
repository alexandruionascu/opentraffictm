import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const entry = path.join(repoRoot, "scripts/traffic-light-inference-entry.ts");
const outfile = path.join(os.tmpdir(), `opentraffictm-traffic-light-inference-${process.pid}.mjs`);

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  packages: "external",
  logLevel: "silent",
});

try {
  const { buildTrafficLightInference } = await import(pathToFileURL(outfile).href);
  const result = buildTrafficLightInference();
  console.log(
    `Wrote ${path.relative(repoRoot, result.outputFile)} from ${result.observations} observations, ` +
      `${result.inferenceTraces} inference traces, ${result.passes} passes, and ${result.estimates} estimates.`,
  );
} finally {
  fs.rmSync(outfile, { force: true });
}

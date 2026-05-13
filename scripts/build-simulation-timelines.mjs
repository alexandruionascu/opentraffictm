import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = process.cwd();
const outDir = path.join(projectRoot, "data", "simulation-timelines");
const stepArg = process.argv.find((arg) => arg.startsWith("--step="));
const frameStepSeconds = stepArg ? Number(stepArg.slice("--step=".length)) : 1;

if (!Number.isFinite(frameStepSeconds) || frameStepSeconds <= 0) {
  throw new Error(`Invalid timeline frame step: ${stepArg}`);
}

const tempDir = await mkdtemp(path.join(tmpdir(), "opentraffictm-timelines-"));
const bundlePath = path.join(tempDir, "build-timelines.mjs");

try {
  await mkdir(outDir, { recursive: true });
  await build({
    absWorkingDir: projectRoot,
    bundle: true,
    format: "esm",
    outfile: bundlePath,
    platform: "node",
    stdin: {
      contents: `
        import { writeFile } from "node:fs/promises";
        import path from "node:path";
        import { scenarios } from "./src/data.ts";
        import { buildScenarioTimeline } from "./src/simulation.ts";

        const outDir = ${JSON.stringify(outDir)};
        const frameStepSeconds = ${JSON.stringify(frameStepSeconds)};
        const generatedAt = new Date().toISOString();
        const files = [];

        for (const scenario of scenarios) {
          const timeline = buildScenarioTimeline(scenario, frameStepSeconds);
          const fileName = scenario.id + ".json";
          const frames = timeline.frames.map((frame) => ({
            t: frame.timeSeconds,
            a: frame.actors.map((actor) => [
              actor.position.lng,
              actor.position.lat,
              actor.headingDeg,
              actor.progress,
              actor.waiting ? 1 : 0,
              actor.speedMps,
              actor.queueIndex,
              actor.laneIndex,
              actor.laneOffsetMeters,
              actor.congestion,
              actor.stoppedFor ?? "",
            ]),
            m: [
              frame.metrics.activeActors,
              frame.metrics.averageProgress,
              frame.metrics.waitingActors,
              frame.metrics.throughput,
              frame.metrics.averageSpeedKmh,
              frame.metrics.queueLength,
              frame.metrics.signalPressure,
            ],
          }));
          const artifact = {
            version: 2,
            generatedAt,
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            durationSeconds: scenario.durationSeconds,
            frameStepSeconds: timeline.frameStepSeconds,
            frames,
          };
          await writeFile(path.join(outDir, fileName), JSON.stringify(artifact), "utf8");
          files.push({
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            file: fileName,
            frameStepSeconds: timeline.frameStepSeconds,
            frameCount: frames.length,
          });
        }

        await writeFile(
          path.join(outDir, "manifest.json"),
          JSON.stringify({ version: 1, generatedAt, files }, null, 2),
          "utf8",
        );

        console.log("Generated " + files.length + " simulation timeline(s) in data/simulation-timelines");
      `,
      loader: "ts",
      resolveDir: projectRoot,
    },
  });

  await import(pathToFileURL(bundlePath).href);
} finally {
  await rm(tempDir, { force: true, recursive: true });
}

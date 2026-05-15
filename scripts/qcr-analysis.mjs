#!/usr/bin/env node
/**
 * qcr-analysis.mjs
 *
 * Queue-to-Capacity Ratio (QCR) and Queue Saturation Index (QSI)
 * for all signals with GPS-derived queue observations.
 *
 * QCR = arrival_rate_vph / (BASE_LANE_CAPACITY_VPH * LANES)
 *      where arrival_rate_vph = queue * 3600 / red_seconds
 *      QCR > 1.0 means arrivals exceed capacity → queue grows each cycle
 *
 * QSI = observed_queue / lane_approach_capacity
 *      lane_approach_capacity = floor(200m / 7.6m) = 26 vehicles
 *      QSI > 0.85 = heavy/saturated approach
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const signals = JSON.parse(readFileSync(join(ROOT, "data/traffic-lights/signals.json"), "utf-8"));
const queues = JSON.parse(readFileSync(join(ROOT, "data/derived/queue-estimates.json"), "utf-8"));

const signalById = {};
for (const p of signals.programs || []) signalById[p.id] = p;

const LANE_LENGTH_METERS = 200;
const JAM_GAP = 7.6; // 4.8 + 2.8
const LANE_CAPACITY = Math.floor(LANE_LENGTH_METERS / JAM_GAP); // 26
const BASE_LANE_CAPACITY_VPH = 1800;
const LANES = 2;

// Build sorted array
const entries = Object.entries(queues.bySignal);
const filtered = entries.filter(function(info) { return info[1].sampleCount >= 50; });
const sorted = filtered.sort(function(a, b) { return b[1].medianQueueVehicles - a[1].medianQueueVehicles; });
const saturated = sorted.filter(function(info) { return info[1].medianQueueVehicles >= 5; });

console.log("Queue-to-Capacity Ratio (QCR) Analysis — GPS-derived queues");
console.log("==========================================================================");
console.log("Approach lane capacity: " + LANE_CAPACITY + " vehicles (" + LANE_LENGTH_METERS + "m / " + JAM_GAP + "m jam gap)");
console.log("Discharge capacity: " + (BASE_LANE_CAPACITY_VPH * LANES) + " vph (2 lanes x 1800 vph/lane)");
console.log("QCR = arrivals_vph / capacity_vph  [QCR > 1.0 = oversaturated, queue grows each cycle]");
console.log("QSI = queue / " + LANE_CAPACITY + "  [QSI > 85% = heavy approach]");
console.log("");

const oversaturated = [];

for (const item of saturated) {
  const sid = item[0];
  const info = item[1];
  const prog = signalById[sid];
  const name = prog ? prog.name : "—";
  const phases = prog ? (prog.phases || []) : [];
  const cycleSeconds = phases.reduce(function(s, p) { return s + (p.durationSeconds || 0); }, 0) || 90;
  const greenSeconds = phases.filter(function(p) { return p.state === "green"; }).reduce(function(s, p) { return s + (p.durationSeconds || 0); }, 0) || 45;
  const redSeconds = Math.max(1, cycleSeconds - greenSeconds);
  const greenRatio = greenSeconds / cycleSeconds;

  const arrivalRateVph = (info.medianQueueVehicles * 3600) / redSeconds;
  const qcr = arrivalRateVph / (BASE_LANE_CAPACITY_VPH * LANES);
  const p95ArrivalRateVph = (info.p95QueueVehicles * 3600) / redSeconds;
  const p95Qcr = p95ArrivalRateVph / (BASE_LANE_CAPACITY_VPH * LANES);
  const qsi = info.medianQueueVehicles / LANE_CAPACITY;
  const p95Qsi = info.p95QueueVehicles / LANE_CAPACITY;

  const level = qcr >= 1.0 ? "OVERSAT" : qcr >= 0.75 ? "HEAVY" : qcr >= 0.5 ? "LIGHT" : "FREE";
  if (qcr >= 1.0) oversaturated.push({ sid: sid, name: name, qcr: qcr, p95Qcr: p95Qcr });

  console.log(
    level.padEnd(7) + " " + sid.padEnd(12) + " " + name.padEnd(20) + " " +
    "QCR=" + qcr.toFixed(2) + " p95=" + p95Qcr.toFixed(2) + " | " +
    "QSI=" + (qsi*100).toFixed(0) + "% p95=" + (p95Qsi*100).toFixed(0) + "% | " +
    "queue=" + info.medianQueueVehicles + "/" + info.p95QueueVehicles + " | " +
    info.sampleCount + " samp | " + cycleSeconds + "s " + (greenRatio*100).toFixed(0) + "%g r=" + redSeconds + "s"
  );
}

// City-wide summary
console.log("\n==========================================================================");
const allQcr = [];
for (const item of sorted) {
  const sid = item[0];
  const info = item[1];
  const prog = signalById[sid];
  const phases = prog ? (prog.phases || []) : [];
  const cycleSeconds = phases.reduce(function(s, p) { return s + (p.durationSeconds || 0); }, 0) || 90;
  const greenSeconds = phases.filter(function(p) { return p.state === "green"; }).reduce(function(s, p) { return s + (p.durationSeconds || 0); }, 0) || 45;
  const redSeconds = Math.max(1, cycleSeconds - greenSeconds);
  const arrivalRateVph = (info.medianQueueVehicles * 3600) / redSeconds;
  const qcr = arrivalRateVph / (BASE_LANE_CAPACITY_VPH * LANES);
  allQcr.push(qcr);
}

const satCount = allQcr.filter(function(q) { return q >= 1.0; }).length;
const heavyCount = allQcr.filter(function(q) { return q >= 0.75 && q < 1.0; }).length;
const lightCount = allQcr.filter(function(q) { return q >= 0.5 && q < 0.75; }).length;
const freeCount = allQcr.filter(function(q) { return q < 0.5; }).length;

console.log("City-wide QCR distribution (signals with >= 50 samples, n=" + allQcr.length + "):");
console.log("  OVERSATURATED (QCR >= 1.0): " + satCount + " signals (" + (satCount/allQcr.length*100).toFixed(0) + "%)");
console.log("  HEAVY        (0.75-1.0):  " + heavyCount + " signals (" + (heavyCount/allQcr.length*100).toFixed(0) + "%)");
console.log("  LIGHT        (0.50-0.75):  " + lightCount + " signals (" + (lightCount/allQcr.length*100).toFixed(0) + "%)");
console.log("  FREE         (<  0.50):  " + freeCount + " signals (" + (freeCount/allQcr.length*100).toFixed(0) + "%)");

console.log("\nInterpretation:");
console.log("  QCR < 1.0: queue clears during green phase (undersaturated)");
console.log("  QCR = 1.0-1.5: near capacity, queue just clears");
console.log("  QCR > 1.5: significant oversaturation (queue grows each cycle)");
console.log("  QCR > 3.0: severe oversaturation");

if (oversaturated.length > 0) {
  console.log("\n==========================================================================");
  console.log("OVERSATURATED SIGNALS (QCR >= 1.0):");
  for (const s of oversaturated) {
    const demand = s.qcr * BASE_LANE_CAPACITY_VPH * LANES;
    console.log("  " + s.sid + " (" + s.name + "): QCR=" + s.qcr.toFixed(2) + " demand=" + demand.toFixed(0) + " vph | p95=" + s.p95Qcr.toFixed(2));
  }
}
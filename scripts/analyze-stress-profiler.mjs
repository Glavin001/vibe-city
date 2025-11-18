#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_PATH =
  "~/Downloads/stress-profiler-2025-11-17T22-41-01.497Z.json";

const targetPath =
  process.argv[2] !== undefined
    ? resolve(process.cwd(), process.argv[2])
    : DEFAULT_PATH;

function readJson(filePath) {
  return readFile(filePath, "utf8").then((contents) => JSON.parse(contents));
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "n/a";
  const parts = [
    ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(2)} ms`,
    `(${ms.toFixed(3)} ms)`,
  ];
  return parts.join(" ");
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.floor(percentileValue * (sorted.length - 1)),
  );
  return sorted[index];
}

function summarize(samples, key) {
  const values = samples
    .map((sample) => sample?.[key])
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) {
    return {
      count: 0,
      average: null,
      max: null,
      p95: null,
    };
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    count: values.length,
    average: sum / values.length,
    max: Math.max(...values),
    p95: percentile(values, 0.95),
  };
}

function printBreakdownSection(title, fields, samples) {
  const rows = fields
    .map((field) => ({ field, stats: summarize(samples, field) }))
    .filter((row) => row.stats.count > 0);
  if (rows.length === 0) return;
  console.log(`${title}:`);
  for (const { field, stats } of rows) {
    console.log(
      `  ${field.padEnd(22)}: ${formatNumber(stats.average)} ms · p95 ${formatNumber(
        stats.p95,
      )} ms · max ${formatNumber(stats.max)} ms`,
    );
  }
  console.log("");
}

async function main() {
  try {
    const payload = await readJson(targetPath);
    const { samples = [], config = {}, startedAt, stoppedAt } = payload;
    if (!Array.isArray(samples) || samples.length === 0) {
      console.error(
        `No samples found in profiler file: ${targetPath}. Did you enable profiling before downloading?`,
      );
      process.exit(1);
    }

    const numericFields = [
      "totalMs",
      "initialPassMs",
      "resimMs",
      "rapierStepMs",
      "contactDrainMs",
      "solverUpdateMs",
      "damageReplayMs",
      "damagePreviewMs",
      "damageTickMs",
      "fractureMs",
      "fractureGenerateMs",
      "fractureApplyMs",
      "splitQueueMs",
      "bodyCreateMs",
      "colliderRebuildMs",
      "cleanupDisabledMs",
      "spawnMs",
      "externalForceMs",
      "damageSnapshotMs",
      "damageRestoreMs",
      "damagePreDestroyMs",
      "damageFlushMs",
      "preStepSweepMs",
      "rebuildColliderMapMs",
      "projectileCleanupMs",
      "snapshotCaptureMs",
      "snapshotRestoreMs",
    ];

    console.log("=== Stress Profiler Report ===");
    console.log(`Source file: ${targetPath}`);
    console.log(`Samples: ${samples.length}`);
    if (startedAt) {
      const started = new Date(startedAt);
      const stopped = new Date(stoppedAt ?? startedAt);
      console.log(`Started: ${started.toISOString()}`);
      console.log(`Stopped: ${stopped.toISOString()}`);
      const durationSec = (stopped.getTime() - started.getTime()) / 1000;
      console.log(`Session duration: ${durationSec.toFixed(2)} s`);
    }
    console.log("");

    console.log("Profiler configuration snapshot:");
    const sortedConfigKeys = Object.keys(config).sort();
    for (const key of sortedConfigKeys) {
      console.log(`  ${key}: ${config[key]}`);
    }
    console.log("");

    console.log("Frame timing overview:");
    const totalStats = summarize(samples, "totalMs");
    console.log(
      `  avg total: ${formatNumber(totalStats.average)} ms · p95: ${formatNumber(totalStats.p95)} ms · max: ${formatNumber(totalStats.max)} ms`,
    );
    const resimStats = summarize(samples, "resimMs");
    const resimFrameCount = samples.filter((s) => (s.resimPasses ?? 0) > 0).length;
    console.log(
      `  frames with resim: ${resimFrameCount} (${((resimFrameCount / samples.length) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  avg resim cost: ${formatNumber(resimStats.average)} ms (${formatNumber((resimStats.average / (totalStats.average || 1)) * 100)}% of avg frame)`,
    );
    console.log("");

    console.log("Phase breakdown (average ms):");
    for (const field of numericFields) {
      const stats = summarize(samples, field);
      if (stats.count === 0) continue;
      const share =
        totalStats.average && stats.average
          ? ` (${((stats.average / totalStats.average) * 100).toFixed(1)}% of frame)`
          : "";
      console.log(
        `  ${field.padEnd(18)}: ${formatNumber(stats.average)} ms · p95 ${formatNumber(stats.p95)} ms · max ${formatNumber(stats.max)} ms${share}`,
      );
    }
    console.log("");
    const fractureFields = [
      "fractureMs",
      "fractureGenerateMs",
      "fractureApplyMs",
      "splitQueueMs",
      "bodyCreateMs",
      "colliderRebuildMs",
      "cleanupDisabledMs",
    ];
    const damageFields = [
      "damageReplayMs",
      "damagePreviewMs",
      "damageTickMs",
      "damageSnapshotMs",
      "damageRestoreMs",
      "damagePreDestroyMs",
      "damageFlushMs",
    ];
    const maintenanceFields = [
      "spawnMs",
      "externalForceMs",
      "preStepSweepMs",
      "rebuildColliderMapMs",
      "projectileCleanupMs",
    ];
    printBreakdownSection("Fracture breakdown", fractureFields, samples);
    printBreakdownSection("Damage breakdown", damageFields, samples);
    printBreakdownSection("Maintenance breakdown", maintenanceFields, samples);

    console.log("Resimulation reasons:");
    const reasonCounts = samples.reduce((acc, sample) => {
      const reasons = Array.isArray(sample.resimReasons)
        ? sample.resimReasons
        : [];
      if (reasons.length === 0 && sample.resimPasses > 0) {
        acc.unknown = (acc.unknown ?? 0) + 1;
      }
      for (const reason of reasons) {
        acc[reason] = (acc[reason] ?? 0) + 1;
      }
      return acc;
    }, {});
    if (Object.keys(reasonCounts).length === 0) {
      console.log("  No resimulation reasons recorded.");
    } else {
      for (const reason of Object.keys(reasonCounts).sort()) {
        console.log(`  ${reason.padEnd(12)}: ${reasonCounts[reason]} frames`);
      }
    }
    console.log("");

    console.log("Top 5 slowest frames:");
    const worstFrames = samples
      .slice()
      .sort((a, b) => (b.totalMs ?? 0) - (a.totalMs ?? 0))
      .slice(0, 5);
    for (const frame of worstFrames) {
      console.log(
        `  frame ${frame.frameIndex.toString().padStart(5)}: ${formatNumber(
          frame.totalMs,
        )} ms (resim passes: ${frame.resimPasses ?? 0}, top reasons: ${(
          frame.resimReasons ?? []
        ).join(", ")})`,
      );
    }
    console.log("");

    console.log("Pass duration summary:");
    const passTotals = samples.reduce(
      (acc, sample) => {
        for (const pass of sample.passes ?? []) {
          const bucket = acc[pass.type];
          bucket.count += 1;
          bucket.total += pass.durationMs ?? 0;
        }
        return acc;
      },
      {
        initial: { count: 0, total: 0 },
        resim: { count: 0, total: 0 },
      },
    );
    for (const [type, { count, total }] of Object.entries(passTotals)) {
      if (count === 0) continue;
      console.log(
        `  ${type.padEnd(7)}: avg ${formatNumber(total / count)} ms across ${count} passes`,
      );
    }
    console.log("");

    console.log(
      `Done. Use "node ${resolve(
        __dirname,
        "analyze-stress-profiler.mjs",
      )} /path/to/your-profiler.json" to analyze another file.`,
    );
  } catch (error) {
    console.error(`Failed to analyze profiler file: ${targetPath}`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

await main();


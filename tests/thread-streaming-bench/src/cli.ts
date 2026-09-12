import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { streamDocumentText } from "bb-plugin-bench-stream-provider/fixtures";
import { prepareGolden } from "./data/golden.js";
import {
  aggregateIterations,
  renderComparison,
  renderMarkdownReport,
  type BenchReport,
  type ScenarioReport,
} from "./report.js";
import { runIteration, type ProfileMode } from "./run/iteration.js";
import { findScenario, SCENARIOS } from "./scenarios.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const USAGE = `Usage:
  pnpm --filter @bb/thread-streaming-bench bench prepare [--cache-dir <dir>]
  pnpm --filter @bb/thread-streaming-bench bench run [--scenario default,long] [--iterations 5] [--warmup 1]
      [--throttle 1] [--profile none|cpu|trace] [--label <name>] [--out <dir>] [--cache-dir <dir>]
      [--artifact-root <checkout>] [--compare-roots base=<checkout>,cand=<checkout>] [--server-profile]
  pnpm --filter @bb/thread-streaming-bench bench compare <baseline results.json> <candidate results.json>

Scenarios: ${SCENARIOS.map((scenario) => `${scenario.name} (${scenario.description})`).join("; ")}
`;

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

function resolveCacheDir(value: string | undefined): string {
  return resolve(
    value ??
      process.env.BB_BENCH_CACHE_DIR ??
      join(homedir(), ".cache", "bb-thread-streaming-bench"),
  );
}

function parseNonNegativeInt(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `${name} must be a non-negative integer, received ${value}`,
    );
  }
  return parsed;
}

function parseProfile(value: string): ProfileMode {
  if (value === "none" || value === "cpu" || value === "trace") {
    return value;
  }
  throw new Error(`--profile must be none, cpu or trace, received ${value}`);
}

function gitRevision(cwd: string): string {
  try {
    const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
    }).trim();
    const dirty =
      execFileSync("git", ["status", "--porcelain"], {
        cwd,
        encoding: "utf8",
      }).trim().length > 0;
    return dirty ? `${revision}+dirty` : revision;
  } catch {
    return "unknown";
  }
}

interface ArtifactRoot {
  label: string;
  path: string;
}

function parseArtifactRoots(
  compareRoots: string | undefined,
  artifactRoot: string | undefined,
  label: string,
): ArtifactRoot[] {
  if (compareRoots === undefined) {
    return [
      {
        label,
        path: artifactRoot === undefined ? repoRoot : resolve(artifactRoot),
      },
    ];
  }
  const roots = compareRoots.split(",").map((entry) => {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      throw new Error(
        `--compare-roots expects label=path entries, received ${entry}`,
      );
    }
    return {
      label: entry.slice(0, separator),
      path: resolve(entry.slice(separator + 1)),
    };
  });
  if (roots.length < 2) {
    throw new Error("--compare-roots needs at least two label=path entries");
  }
  return roots;
}

async function runCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      "cache-dir": { type: "string" },
      "artifact-root": { type: "string" },
      "compare-roots": { type: "string" },
      "server-profile": { default: false, type: "boolean" },
      iterations: { default: "5", type: "string" },
      label: { default: "run", type: "string" },
      out: { type: "string" },
      profile: { default: "none", type: "string" },
      scenario: { default: "default", type: "string" },
      throttle: { default: "1", type: "string" },
      warmup: { default: "1", type: "string" },
    },
  });
  const cacheDir = resolveCacheDir(values["cache-dir"]);
  const scenarios = values.scenario
    .split(",")
    .map((name) => findScenario(name.trim()));
  const iterations = parseNonNegativeInt("--iterations", values.iterations);
  const warmup = parseNonNegativeInt("--warmup", values.warmup);
  const cpuThrottlingRate = Number(values.throttle);
  if (!(cpuThrottlingRate >= 1)) {
    throw new Error(
      `--throttle must be a number >= 1, received ${values.throttle}`,
    );
  }
  const profile = parseProfile(values.profile);
  const roots = parseArtifactRoots(
    values["compare-roots"],
    values["artifact-root"],
    values.label,
  );
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const outDir = resolve(
    values.out ?? join(cacheDir, "results", `${values.label}-${stamp}`),
  );
  const golden = await prepareGolden({ cacheDir, log, repoRoot });
  const runs = roots.map((root) => {
    const dir = roots.length === 1 ? outDir : join(outDir, root.label);
    mkdirSync(dir, { recursive: true });
    const report: BenchReport = {
      metadata: {
        chromeVersion: "",
        cpuThrottlingRate,
        gitRevision: `${gitRevision(root.path)} artifacts=${root.path}`,
        goldenHash: golden.manifest.hash,
        label: root.label,
        loadAverage: loadavg(),
        nodeVersion: process.version,
        profile,
        startedAt: startedAt.toISOString(),
      },
      scenarios: [],
    };
    return { dir, report, root };
  });
  for (const scenario of scenarios) {
    const fixtureText = streamDocumentText(scenario.doc, scenario.repeat);
    const scenarioRuns = runs.map((run) => {
      const scenarioReport: ScenarioReport = {
        aggregate: {},
        iterations: [],
        name: scenario.name,
        warmup: [],
      };
      run.report.scenarios.push(scenarioReport);
      return { ...run, scenarioReport };
    });
    for (let index = 0; index < warmup + iterations; index += 1) {
      const isWarmup = index < warmup;
      const iterationNumber = isWarmup ? index : index - warmup;
      const order =
        index % 2 === 0 ? scenarioRuns : [...scenarioRuns].reverse();
      for (const { dir, report, root, scenarioReport } of order) {
        log(
          `${scenario.name} [${root.label}]: ${isWarmup ? "warmup" : "iteration"} ${iterationNumber + 1}`,
        );
        const result = await runIteration({
          cpuThrottlingRate,
          fixtureText,
          golden,
          iteration: iterationNumber,
          iterationDir: join(
            cacheDir,
            "work",
            `${scenario.name}-${root.label}-${index}`,
          ),
          log,
          profile,
          repoRoot: root.path,
          scenario,
          serverProfile: values["server-profile"],
        });
        writeFileSync(
          join(
            dir,
            `${scenario.name}-${isWarmup ? "warmup" : "iter"}-${iterationNumber}.json`,
          ),
          JSON.stringify(result, null, 2),
        );
        log(
          `  task ${result.metrics.mainThread.taskDurationMs.toFixed(0)} ms, loaf blocking ${result.metrics.loafs.totalBlockingDurationMs.toFixed(0)} ms, commits ${result.metrics.reactCommits}, timeline GETs ${result.metrics.network.timeline.total.count}, server cpu ${result.metrics.serverCpuMs.toFixed(0)} ms, latency p50 ${result.metrics.checkpoints.p50LatencyMs?.toFixed(0) ?? "—"} ms, geometry ${result.metrics.geometry.sha256.slice(0, 12)}, text ${result.metrics.finalText.sha256.slice(0, 12)}`,
        );
        report.metadata.chromeVersion = result.chromeVersion;
        (isWarmup ? scenarioReport.warmup : scenarioReport.iterations).push(
          result,
        );
      }
    }
    for (const { scenarioReport } of scenarioRuns) {
      scenarioReport.aggregate = aggregateIterations(scenarioReport.iterations);
    }
  }
  const markdownParts = runs.map(({ dir, report }) => {
    writeFileSync(join(dir, "results.json"), JSON.stringify(report, null, 2));
    const markdown = renderMarkdownReport(report);
    writeFileSync(join(dir, "summary.md"), markdown);
    return markdown;
  });
  const [baseline, ...candidates] = runs;
  for (const candidate of candidates) {
    const comparison = renderComparison(baseline.report, candidate.report);
    writeFileSync(
      join(outDir, `comparison-${candidate.root.label}.md`),
      comparison,
    );
    markdownParts.push(comparison);
  }
  process.stdout.write(`${markdownParts.join("\n\n")}\nResults: ${outDir}\n`);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "prepare": {
      const { values } = parseArgs({
        args: rest,
        options: { "cache-dir": { type: "string" } },
      });
      await prepareGolden({
        cacheDir: resolveCacheDir(values["cache-dir"]),
        log,
        repoRoot,
      });
      return;
    }
    case "run":
      await runCommand(rest);
      return;
    case "compare": {
      const [baselinePath, candidatePath] = rest;
      if (baselinePath === undefined || candidatePath === undefined) {
        throw new Error(USAGE);
      }
      const baseline = JSON.parse(
        readFileSync(baselinePath, "utf8"),
      ) as BenchReport;
      const candidate = JSON.parse(
        readFileSync(candidatePath, "utf8"),
      ) as BenchReport;
      process.stdout.write(`${renderComparison(baseline, candidate)}\n`);
      return;
    }
    default:
      process.stdout.write(USAGE);
  }
}

await main(process.argv.slice(2));

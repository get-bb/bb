import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getFixture } from "bb-plugin-bench-stream-provider/fixtures";
import { launchBenchBrowser } from "./browser/driver.js";
import { DEFAULT_GOLDEN_SPEC, prepareGolden } from "./data/golden.js";
import {
  aggregateIterations,
  renderComparison,
  renderMarkdownReport,
  type BenchReport,
  type ScenarioReport,
} from "./report.js";
import { runIteration, type ProfileMode } from "./run/iteration.js";
import { findScenario, SCENARIOS, type Scenario } from "./scenarios.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const USAGE = `Usage:
  pnpm --filter @bb/thread-streaming-bench bench prepare [--cache-dir <dir>]
  pnpm --filter @bb/thread-streaming-bench bench run [--scenario default,long] [--iterations 5] [--warmup 1]
      [--throttle 1] [--profile none|cpu|trace] [--label <name>] [--out <dir>] [--cache-dir <dir>]
      [--artifact-root <checkout>] [--compare-roots base=<checkout>,cand=<checkout>] [--server-profile]
      [--inject-css <file>] [--inject-js <file>] [--reduced-motion]
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

function parsePositiveInt(name: string, value: string): number {
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

function fixtureTextFor(scenario: Scenario): string {
  const doc = getFixture(scenario.doc);
  return Array.from({ length: scenario.repeat }, () => doc).join("\n\n");
}

function gitRevision(): string {
  try {
    const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const dirty =
      execFileSync("git", ["status", "--porcelain"], {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim().length > 0;
    return dirty ? `${revision}+dirty` : revision;
  } catch {
    return "unknown";
  }
}

async function chromeVersion(cacheDir: string): Promise<string> {
  const browser = await launchBenchBrowser({
    userDataDir: join(cacheDir, "chrome-version-probe"),
  });
  try {
    return (await browser.version()).product;
  } finally {
    await browser.close();
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

function interleavedOrder(
  roots: readonly ArtifactRoot[],
  index: number,
): ArtifactRoot[] {
  return index % 2 === 0 ? [...roots] : [...roots].reverse();
}

async function runCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      "cache-dir": { type: "string" },
      "artifact-root": { type: "string" },
      "compare-roots": { type: "string" },
      "inject-css": { type: "string" },
      "inject-js": { type: "string" },
      "reduced-motion": { default: false, type: "boolean" },
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
  const iterations = parsePositiveInt("--iterations", values.iterations);
  const warmup = parsePositiveInt("--warmup", values.warmup);
  const cpuThrottlingRate = Number(values.throttle);
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
  mkdirSync(outDir, { recursive: true });
  const golden = await prepareGolden({
    cacheDir,
    log,
    repoRoot,
    spec: DEFAULT_GOLDEN_SPEC,
  });
  const chrome = await chromeVersion(cacheDir);
  const experiment = {
    injectCss:
      values["inject-css"] === undefined
        ? null
        : readFileSync(resolve(values["inject-css"]), "utf8"),
    injectJs:
      values["inject-js"] === undefined
        ? null
        : readFileSync(resolve(values["inject-js"]), "utf8"),
    reducedMotion: values["reduced-motion"],
  };
  const reports = new Map<string, BenchReport>(
    roots.map((root) => [
      root.label,
      {
        metadata: {
          chromeVersion: chrome,
          cpuThrottlingRate,
          gitRevision: `${gitRevision()} artifacts=${root.path}`,
          goldenHash: golden.manifest.hash,
          label: root.label,
          loadAverage: loadavg(),
          nodeVersion: process.version,
          profile: [
            profile,
            values["inject-css"] === undefined
              ? null
              : `css=${values["inject-css"]}`,
            values["inject-js"] === undefined
              ? null
              : `js=${values["inject-js"]}`,
            values["reduced-motion"] ? "reduced-motion" : null,
          ]
            .filter((part) => part !== null)
            .join(" "),
          startedAt: startedAt.toISOString(),
        },
        scenarios: [],
      },
    ]),
  );
  for (const scenario of scenarios) {
    const fixtureText = fixtureTextFor(scenario);
    const scenarioReports = new Map<string, ScenarioReport>(
      roots.map((root) => [
        root.label,
        { aggregate: {}, iterations: [], name: scenario.name, warmup: [] },
      ]),
    );
    for (let index = 0; index < warmup + iterations; index += 1) {
      const isWarmup = index < warmup;
      const iterationNumber = isWarmup ? index : index - warmup;
      for (const root of interleavedOrder(roots, index)) {
        log(
          `${scenario.name} [${root.label}]: ${isWarmup ? "warmup" : "iteration"} ${iterationNumber + 1}`,
        );
        const result = await runIteration({
          cpuThrottlingRate,
          experiment,
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
        const rootDir = roots.length === 1 ? outDir : join(outDir, root.label);
        mkdirSync(rootDir, { recursive: true });
        writeFileSync(
          join(
            rootDir,
            `${scenario.name}-${isWarmup ? "warmup" : "iter"}-${iterationNumber}.json`,
          ),
          JSON.stringify(result, null, 2),
        );
        log(
          `  task ${result.metrics.mainThread.taskDurationMs.toFixed(0)} ms, loaf blocking ${result.metrics.loafs.totalBlockingDurationMs.toFixed(0)} ms, commits ${result.metrics.reactCommits}, timeline GETs ${result.metrics.network.timeline.total.count}, server cpu ${result.metrics.serverCpuMs.toFixed(0)} ms, latency p50 ${result.metrics.checkpoints.p50LatencyMs?.toFixed(0) ?? "—"} ms, geometry ${result.metrics.geometry.sha256.slice(0, 12)}, text ${result.metrics.finalText.sha256.slice(0, 12)}`,
        );
        const scenarioReport = scenarioReports.get(root.label);
        if (scenarioReport === undefined) {
          continue;
        }
        if (isWarmup) {
          scenarioReport.warmup.push(result);
        } else {
          scenarioReport.iterations.push(result);
        }
      }
    }
    for (const root of roots) {
      const scenarioReport = scenarioReports.get(root.label);
      const report = reports.get(root.label);
      if (scenarioReport === undefined || report === undefined) {
        continue;
      }
      scenarioReport.aggregate = aggregateIterations(scenarioReport.iterations);
      report.scenarios.push(scenarioReport);
    }
  }
  const markdownParts: string[] = [];
  for (const root of roots) {
    const report = reports.get(root.label);
    if (report === undefined) {
      continue;
    }
    const rootDir = roots.length === 1 ? outDir : join(outDir, root.label);
    mkdirSync(rootDir, { recursive: true });
    writeFileSync(
      join(rootDir, "results.json"),
      JSON.stringify(report, null, 2),
    );
    const markdown = renderMarkdownReport(report);
    writeFileSync(join(rootDir, "summary.md"), markdown);
    markdownParts.push(markdown);
  }
  const baselineReport = reports.get(roots[0]?.label ?? "");
  if (roots.length > 1 && baselineReport !== undefined) {
    for (const root of roots.slice(1)) {
      const candidateReport = reports.get(root.label);
      if (candidateReport === undefined) {
        continue;
      }
      const comparison = renderComparison(baselineReport, candidateReport);
      writeFileSync(join(outDir, `comparison-${root.label}.md`), comparison);
      markdownParts.push(comparison);
    }
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
        spec: DEFAULT_GOLDEN_SPEC,
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

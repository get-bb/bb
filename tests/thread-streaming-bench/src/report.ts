import type { IterationMetrics, IterationResult } from "./run/iteration.js";

export interface RunMetadata {
  chromeVersion: string;
  cpuThrottlingRate: number;
  gitRevision: string;
  goldenHash: string;
  label: string;
  loadAverage: number[];
  nodeVersion: string;
  profile: string;
  startedAt: string;
}

export interface ScenarioReport {
  aggregate: Record<string, { median: number | null; min: number | null }>;
  iterations: IterationResult[];
  name: string;
  warmup: IterationResult[];
}

export interface BenchReport {
  metadata: RunMetadata;
  scenarios: ScenarioReport[];
}

export const HEADLINE_METRICS: readonly {
  key: string;
  label: string;
  read: (metrics: IterationMetrics) => number | null;
  unit: string;
}[] = [
  {
    key: "taskMs",
    label: "Main-thread task time",
    read: (m) => m.mainThread.taskDurationMs,
    unit: "ms",
  },
  {
    key: "scriptMs",
    label: "Script time",
    read: (m) => m.mainThread.scriptDurationMs,
    unit: "ms",
  },
  {
    key: "layoutMs",
    label: "CDP LayoutDuration",
    read: (m) => m.mainThread.layoutDurationMs,
    unit: "ms",
  },
  {
    key: "styleMs",
    label: "CDP RecalcStyleDuration (includes forced layout)",
    read: (m) => m.mainThread.recalcStyleDurationMs,
    unit: "ms",
  },
  {
    key: "layoutCount",
    label: "CDP LayoutCount",
    read: (m) => m.mainThread.layoutCount,
    unit: "",
  },
  {
    key: "loafBlockingMs",
    label: "LoAF blocking time",
    read: (m) => m.loafs.totalBlockingDurationMs,
    unit: "ms",
  },
  {
    key: "loafCount",
    label: "Long animation frames",
    read: (m) => m.loafs.count,
    unit: "",
  },
  {
    key: "longTaskTbtMs",
    label: "Long-task TBT",
    read: (m) => m.longTasks.totalBlockingTimeMs,
    unit: "ms",
  },
  {
    key: "framesOver50",
    label: "Frames > 50 ms",
    read: (m) => m.frames.framesOver50Ms,
    unit: "",
  },
  {
    key: "frameP95Ms",
    label: "Frame interval p95",
    read: (m) => m.frames.p95IntervalMs,
    unit: "ms",
  },
  {
    key: "reactCommits",
    label: "React commits",
    read: (m) => m.reactCommits,
    unit: "",
  },
  {
    key: "timelineRequests",
    label: "Timeline requests",
    read: (m) => m.network.timeline.total.count,
    unit: "",
  },
  {
    key: "timelineBytes",
    label: "Timeline bytes",
    read: (m) => m.network.timeline.total.bytes,
    unit: "B",
  },
  {
    key: "timelineP50Ms",
    label: "Timeline request p50",
    read: (m) => m.network.timeline.total.p50Ms,
    unit: "ms",
  },
  {
    key: "latencyP50Ms",
    label: "Line render latency p50",
    read: (m) => m.checkpoints.p50LatencyMs,
    unit: "ms",
  },
  {
    key: "latencyP95Ms",
    label: "Line render latency p95",
    read: (m) => m.checkpoints.p95LatencyMs,
    unit: "ms",
  },
  {
    key: "serverCpuMs",
    label: "Server CPU",
    read: (m) => m.serverCpuMs,
    unit: "ms",
  },
  {
    key: "daemonCpuMs",
    label: "Host daemon CPU",
    read: (m) => m.daemonCpuMs,
    unit: "ms",
  },
  {
    key: "domAddedNodes",
    label: "DOM nodes added (mutation records)",
    read: (m) => m.domMutations.addedNodes,
    unit: "",
  },
  {
    key: "styleMsPerLayout",
    label: "RecalcStyle ms per layout",
    read: (m) =>
      m.mainThread.layoutCount === 0
        ? null
        : m.mainThread.recalcStyleDurationMs / m.mainThread.layoutCount,
    unit: "ms",
  },
  {
    key: "pinnedFraction",
    label: "Pinned to bottom (fraction)",
    read: (m) => m.pinnedToBottom.pinnedFraction,
    unit: "",
  },
  {
    key: "retainedHeapMb",
    label: "JS heap retained after GC",
    read: (m) =>
      typeof m.retainedHeapDeltaBytes === "number"
        ? m.retainedHeapDeltaBytes / 1_048_576
        : null,
    unit: "MB",
  },
  {
    key: "heapDeltaMb",
    label: "JS heap delta",
    read: (m) => m.mainThread.jsHeapUsedSizeBytes / 1_048_576,
    unit: "MB",
  },
];

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function aggregateIterations(
  iterations: readonly IterationResult[],
): ScenarioReport["aggregate"] {
  const aggregate: ScenarioReport["aggregate"] = {};
  for (const metric of HEADLINE_METRICS) {
    const values = iterations.flatMap((iteration) => {
      const value = metric.read(iteration.metrics);
      return value === null ? [] : [value];
    });
    aggregate[metric.key] = {
      median: median(values),
      min: values.length === 0 ? null : Math.min(...values),
    };
  }
  return aggregate;
}

function format(value: number | null, unit: string): string {
  if (value === null) {
    return "—";
  }
  if (unit === "B") {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  return unit === "" ? rounded : `${rounded} ${unit}`;
}

export function renderMarkdownReport(report: BenchReport): string {
  const lines = [
    `# Thread streaming benchmark — ${report.metadata.label}`,
    "",
    `- started: ${report.metadata.startedAt}`,
    `- git: ${report.metadata.gitRevision}`,
    `- chrome: ${report.metadata.chromeVersion}, node ${report.metadata.nodeVersion}`,
    `- cpu throttling: ${report.metadata.cpuThrottlingRate}x, profile: ${report.metadata.profile}`,
    `- golden data: ${report.metadata.goldenHash}, load average: ${report.metadata.loadAverage.map((value) => value.toFixed(2)).join(" ")}`,
    "",
  ];
  for (const scenario of report.scenarios) {
    lines.push(
      `## ${scenario.name} (${scenario.iterations.length} iterations)`,
      "",
    );
    lines.push("| Metric | median | min |", "| --- | ---: | ---: |");
    for (const metric of HEADLINE_METRICS) {
      const value = scenario.aggregate[metric.key];
      lines.push(
        `| ${metric.label} | ${format(value?.median ?? null, metric.unit)} | ${format(value?.min ?? null, metric.unit)} |`,
      );
    }
    const hashes = new Set(
      scenario.iterations.map(
        (iteration) => iteration.metrics.finalText.sha256,
      ),
    );
    lines.push(
      "",
      `Final message text hashes: ${[...hashes].map((hash) => hash.slice(0, 12)).join(", ")}`,
      "",
    );
  }
  return lines.join("\n");
}

export function renderComparison(
  baseline: BenchReport,
  candidate: BenchReport,
): string {
  const lines = [
    `# ${candidate.metadata.label} vs ${baseline.metadata.label}`,
    "",
  ];
  for (const scenario of candidate.scenarios) {
    const base = baseline.scenarios.find(
      (entry) => entry.name === scenario.name,
    );
    if (base === undefined) {
      continue;
    }
    lines.push(
      `## ${scenario.name}`,
      "",
      "| Metric | baseline median | candidate median | change |",
      "| --- | ---: | ---: | ---: |",
    );
    for (const metric of HEADLINE_METRICS) {
      const before = base.aggregate[metric.key]?.median ?? null;
      const after = scenario.aggregate[metric.key]?.median ?? null;
      const change =
        before === null || after === null || before === 0
          ? "—"
          : `${(((after - before) / before) * 100).toFixed(1)}%`;
      lines.push(
        `| ${metric.label} | ${format(before, metric.unit)} | ${format(after, metric.unit)} | ${change} |`,
      );
    }
    const baseHashes = new Set(
      base.iterations.map((iteration) => iteration.metrics.finalText.sha256),
    );
    const candidateHashes = new Set(
      scenario.iterations.map(
        (iteration) => iteration.metrics.finalText.sha256,
      ),
    );
    const sameText = [...candidateHashes].every((hash) => baseHashes.has(hash));
    lines.push(
      "",
      `Final message text identical to baseline: ${sameText ? "yes" : "NO"}`,
    );
    const baseGeometry = new Set(
      base.iterations.map((iteration) => iteration.metrics.geometry?.sha256),
    );
    const candidateGeometry = new Set(
      scenario.iterations.map(
        (iteration) => iteration.metrics.geometry?.sha256,
      ),
    );
    const sameGeometry = [...candidateGeometry].every(
      (hash) => hash !== undefined && baseGeometry.has(hash),
    );
    lines.push(
      `Final timeline geometry identical to baseline: ${sameGeometry ? "yes" : "NO (or baseline has no geometry)"}`,
      "",
    );
  }
  return lines.join("\n");
}

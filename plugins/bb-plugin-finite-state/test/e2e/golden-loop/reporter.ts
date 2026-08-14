import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import type {
  BeatResult,
  GoldenLoopMode,
  GoldenLoopAssertion,
} from "./scenario.js";

const SECRET_KEY =
  /(?:authorization|cookie|password|secret|token|api[-_]?key)/iu;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/giu;

export interface OfflineViolationReport {
  beat: number | null;
  caller: string;
  target: string;
}

export interface GoldenLoopMachineReport {
  schemaVersion: 1;
  mode: GoldenLoopMode;
  seed: string;
  startedAt: string;
  durationMs: number;
  status: "passed" | "failed";
  results: BeatResult[];
  offlineViolations: OfflineViolationReport[];
  ohMoments: Partial<Record<"5" | "7" | "11" | "12", string[]>>;
}

export interface GoldenLoopArtifactWriter {
  readonly root: string;
  writeJson(name: string, value: unknown): Promise<string>;
  writeText(name: string, value: string): Promise<string>;
  written(): readonly string[];
}

function inside(root: string, name: string): string {
  const absolute = resolve(root, name);
  const pathFromRoot = relative(root, absolute);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith("../") ||
    pathFromRoot.startsWith("..\\")
  ) {
    throw new Error(`Artifact path escapes run directory: ${name}`);
  }
  return absolute;
}

export function sanitizeEvidence(value: unknown): unknown {
  if (typeof value === "string")
    return value.replace(BEARER, "Bearer [REDACTED]");
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? "[REDACTED]" : sanitizeEvidence(item),
      ]),
    );
  }
  return value;
}

export function createArtifactWriter(root: string): GoldenLoopArtifactWriter {
  const written: string[] = [];
  return {
    root,
    async writeJson(name, value) {
      const target = inside(root, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(
        target,
        `${JSON.stringify(sanitizeEvidence(value), null, 2)}\n`,
        "utf8",
      );
      written.push(target);
      return target;
    },
    async writeText(name, value) {
      const target = inside(root, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(
        target,
        `${String(sanitizeEvidence(value)).replace(/\n?$/u, "\n")}`,
        "utf8",
      );
      written.push(target);
      return target;
    },
    written: () => [...written],
  };
}

export function semanticReport(report: GoldenLoopMachineReport): unknown {
  return {
    ...report,
    durationMs: 0,
    results: report.results.map((result) => ({
      ...result,
      durationMs: 0,
      artifacts: result.artifacts.map((artifact) => artifact.split("/").at(-1)),
    })),
  };
}

export async function writeGoldenLoopReports(
  writer: GoldenLoopArtifactWriter,
  report: GoldenLoopMachineReport,
): Promise<Readonly<{ machine: string; rehearsal: string }>> {
  const machine = await writer.writeJson("golden-loop-report.json", report);
  const passed = report.results.filter(
    ({ status }) => status === "passed",
  ).length;
  const failed = report.results.filter(
    ({ status }) => status === "failed",
  ).length;
  const pending = report.results.filter(
    ({ status }) => status === "skipped",
  ).length;
  const lines = [
    "# Golden Loop rehearsal",
    "",
    `- Result: ${report.status.toUpperCase()}`,
    `- Mode: ${report.mode}`,
    `- Duration: ${report.durationMs} ms`,
    `- Beats: ${passed} passed, ${failed} failed, ${pending} pending/skipped`,
    `- Offline violations: ${report.offlineViolations.length}`,
    "",
    "## Beats",
    "",
    ...report.results.map(
      (result) =>
        `- ${result.beat}. ${result.name}: ${result.status} (${result.durationMs} ms)`,
    ),
    "",
    "## Oh moments",
    "",
    ...([5, 7, 11, 12] as const).map((beat) => {
      const artifacts =
        report.ohMoments[String(beat) as "5" | "7" | "11" | "12"];
      return `- Beat ${beat}: ${artifacts?.join(", ") || "no artifact captured"}`;
    }),
  ];
  const rehearsal = await writer.writeText(
    "golden-loop-rehearsal.md",
    lines.join("\n"),
  );
  return { machine, rehearsal };
}

export function failedAssertion(error: unknown): GoldenLoopAssertion {
  return {
    name: "beat completed",
    passed: false,
    detail: error instanceof Error ? error.message : String(error),
  };
}

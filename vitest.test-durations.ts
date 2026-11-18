import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Reporter, TestCase } from "vitest/node";

export const RECORDED_TIMEOUT_FRACTION = 0.25;

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export interface TestDurationRecord {
  file: string;
  name: string;
  project: string;
  platform: NodeJS.Platform;
  state: "passed" | "failed";
  durationMs: number;
  timeoutMs: number;
}

export function testDurationRecord(
  testCase: TestCase,
): TestDurationRecord | null {
  const result = testCase.result();
  if (result.state !== "passed" && result.state !== "failed") return null;
  const durationMs = testCase.diagnostic()?.duration;
  const timeoutMs =
    testCase.options.timeout ?? testCase.project.config.testTimeout;
  if (durationMs === undefined || !(timeoutMs > 0)) return null;
  if (durationMs < timeoutMs * RECORDED_TIMEOUT_FRACTION) return null;
  return {
    file: path
      .relative(repoRoot, testCase.module.moduleId)
      .split(path.sep)
      .join("/"),
    name: testCase.fullName,
    project: testCase.project.name,
    platform: process.platform,
    state: result.state,
    durationMs: Math.round(durationMs),
    timeoutMs,
  };
}

export class TestDurationReporter implements Reporter {
  readonly #file: string;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.#file = path.join(directory, `${process.pid}.jsonl`);
  }

  onTestCaseResult(testCase: TestCase): void {
    const record = testDurationRecord(testCase);
    if (record !== null) {
      appendFileSync(this.#file, `${JSON.stringify(record)}\n`);
    }
  }
}

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const NEAR_LIMIT_FRACTION = 0.5;

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

export function parseDurationRecord(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.file !== "string" ||
    typeof value.name !== "string" ||
    typeof value.platform !== "string" ||
    (value.state !== "passed" && value.state !== "failed") ||
    !Number.isFinite(value.durationMs) ||
    !Number.isFinite(value.timeoutMs) ||
    value.timeoutMs <= 0
  ) {
    return null;
  }
  return {
    file: value.file,
    name: value.name,
    platform: value.platform,
    state: value.state,
    durationMs: value.durationMs,
    timeoutMs: value.timeoutMs,
  };
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith(".jsonl") ? [path] : [];
  });
}

export function readDurationRecords(root) {
  return walk(root).flatMap((path) => {
    const run = relative(root, path).split(sep)[0];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        const record = parseDurationRecord(line);
        return record === null ? [] : [{ ...record, run }];
      });
  });
}

export function summarizeTestHeadroom(
  records,
  nearFraction = NEAR_LIMIT_FRACTION,
) {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.platform}\u0000${record.file}\u0000${record.name}`;
    const group = groups.get(key) ?? {
      platform: record.platform,
      file: record.file,
      name: record.name,
      runs: new Set(),
      nearRuns: new Set(),
      failedRuns: new Set(),
      worst: record,
    };
    group.runs.add(record.run);
    const ratio = record.durationMs / record.timeoutMs;
    if (ratio >= nearFraction) group.nearRuns.add(record.run);
    if (record.state === "failed") group.failedRuns.add(record.run);
    if (ratio > group.worst.durationMs / group.worst.timeoutMs) {
      group.worst = record;
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.nearRuns.size > 0)
    .map((group) => ({
      platform: group.platform,
      file: group.file,
      name: group.name,
      nearRuns: group.nearRuns.size,
      failedRuns: group.failedRuns.size,
      worstDurationMs: group.worst.durationMs,
      timeoutMs: group.worst.timeoutMs,
      worstFraction: group.worst.durationMs / group.worst.timeoutMs,
    }))
    .sort(
      (a, b) =>
        b.worstFraction - a.worstFraction ||
        b.nearRuns - a.nearRuns ||
        a.file.localeCompare(b.file) ||
        a.name.localeCompare(b.name),
    );
}

export function testHeadroomMarkdown(rows, runCount) {
  const escape = (value) =>
    String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  const lines = [
    "## Tests near their time limit",
    "",
    `${rows.length} tests used at least ${Math.round(NEAR_LIMIT_FRACTION * 100)}% of their timeout in ${runCount} recent main runs. Make each one cheaper, share its setup, or split it; raising its timeout only hides the cost.`,
  ];
  if (rows.length === 0) return lines.join("\n");
  lines.push(
    "",
    "| Worst | Timeout | Runs near limit | Failed runs | Platform | Test |",
    "| ---: | ---: | ---: | ---: | --- | --- |",
  );
  for (const row of rows) {
    lines.push(
      `| ${(row.worstDurationMs / 1000).toFixed(1)} s (${Math.round(row.worstFraction * 100)}%) | ${(row.timeoutMs / 1000).toFixed(1)} s | ${row.nearRuns} | ${row.failedRuns} | ${escape(row.platform)} | \`${escape(row.file)}\` › ${escape(row.name)} |`,
    );
  }
  return lines.join("\n");
}

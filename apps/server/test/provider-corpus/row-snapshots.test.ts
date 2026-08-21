/**
 * A4 — production-thread row snapshots.
 *
 * Projects every corpus thread through the timeline route path and compares
 * the rows with the snapshot written at the last accepted baseline. Runs only
 * when `BB_PROVIDER_CORPUS_DIR` points at the private corpus; see
 * docs/debugging-and-qa.md ("Provider corpus") for write and compare runs.
 */
import fs from "node:fs";
import path from "node:path";
import {
  corpusAvailable,
  listCorpusThreads,
  loadCorpusThread,
  resolveProviderCorpusDir,
} from "@bb/test-helpers";
import type { CorpusThread } from "@bb/test-helpers";
import type { TimelineRow } from "@bb/server-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProviderRegistryService } from "../../src/services/providers/provider-registry.js";
import { createTestProviderRegistry } from "../helpers/provider-registry.js";
import {
  TIMELINE_VARIANTS,
  applyAllowlist,
  buildAllRouteTimelinePages,
  describeAllowlistEntry,
  diffJson,
  loadCorpusThreadIntoDb,
  normalizeJson,
  readAllowlist,
  resolveSnapshotMode,
  unifiedJsonDiff,
  type JsonDiff,
  type JsonValue,
  type LoadedCorpusThread,
} from "./corpus-harness.js";

const PER_THREAD_TIMEOUT_MS = 5 * 60_000;
const PRINTED_DIFF_THREAD_LIMIT = 3;

interface RowSnapshot {
  eventRows: number;
  provider: string;
  threadId: string;
  variants: Record<string, { pages: unknown[] }>;
}

/**
 * Top-level rows plus the children a completed turn carries in the nested
 * variant (the default variant summarizes a turn and leaves `children` null).
 */
function countTimelineRows(rows: readonly TimelineRow[]): number {
  let count = 0;
  for (const row of rows) {
    count += 1;
    if (row.kind === "turn" && row.children !== null) {
      count += countTimelineRows(row.children);
    }
  }
  return count;
}

function buildRowSnapshot(
  loaded: LoadedCorpusThread,
  corpusThread: CorpusThread,
  registry: ProviderRegistryService,
): { rows: number; snapshot: JsonValue } {
  let rows = 0;
  const variants: RowSnapshot["variants"] = {};
  for (const variant of TIMELINE_VARIANTS) {
    const pages = buildAllRouteTimelinePages({
      db: loaded.db,
      registry,
      thread: loaded.thread,
      variant,
    });
    for (const page of pages) {
      rows += countTimelineRows(page.response.rows);
    }
    variants[variant] = { pages: pages.map((page) => page.response) };
  }
  const snapshot: RowSnapshot = {
    threadId: corpusThread.id,
    provider: corpusThread.provider,
    eventRows: corpusThread.eventRows.length,
    variants,
  };
  return { rows, snapshot: normalizeJson(snapshot) };
}

/**
 * The reader already restricts ids to one safe path segment; this keeps the
 * resolved file under the rows root even if that validation ever loosens.
 */
function snapshotFilePath(
  snapshotsDir: string,
  provider: string,
  threadId: string,
): string {
  const rowsRoot = path.resolve(snapshotsDir, "rows");
  const filePath = path.resolve(rowsRoot, provider, `${threadId}.json`);
  if (!filePath.startsWith(`${rowsRoot}${path.sep}`)) {
    throw new Error(
      `Snapshot path for ${provider}/${threadId} escapes ${rowsRoot}`,
    );
  }
  return filePath;
}

function formatDiffs(diffs: readonly JsonDiff[], limit: number): string {
  const shown = diffs.slice(0, limit).map((diff) => {
    const expected = JSON.stringify(diff.expected)?.slice(0, 200);
    const actual = JSON.stringify(diff.actual)?.slice(0, 200);
    return `  ${diff.pointer}\n    snapshot: ${expected}\n    current:  ${actual}`;
  });
  const more = diffs.length > limit ? `\n  … ${diffs.length - limit} more` : "";
  return `${shown.join("\n")}${more}`;
}

const available = corpusAvailable();
const mode = resolveSnapshotMode();
const corpusThreads = available ? listCorpusThreads() : [];

describe.skipIf(!available)("provider corpus row snapshots", () => {
  // The describe body still runs at collection time when the suite is skipped,
  // so everything here must tolerate a missing corpus.
  const corpusDir = resolveProviderCorpusDir() ?? "";
  const snapshotsDir = path.join(corpusDir, "snapshots");
  const allowlist = available ? readAllowlist(snapshotsDir) : [];
  const usedAllowlistEntries = new Set<number>();
  let registry: ProviderRegistryService | null = null;
  const totals = {
    bytes: 0,
    diffThreads: [] as string[],
    allowedDiffs: 0,
    printedDiffThreads: 0,
    rows: 0,
    startedAt: performance.now(),
    threads: 0,
  };

  beforeAll(async () => {
    if (available) {
      registry = await createTestProviderRegistry();
    }
  });

  it.each(corpusThreads.map((thread) => [thread.id, thread.provider] as const))(
    "%s (%s)",
    (threadId, provider) => {
      if (registry === null) {
        throw new Error("provider registry did not load");
      }
      const corpusThread = loadCorpusThread(threadId);
      const loaded = loadCorpusThreadIntoDb(corpusThread);
      try {
        const built = buildRowSnapshot(loaded, corpusThread, registry);
        const serialized = `${JSON.stringify(built.snapshot)}\n`;
        totals.threads += 1;
        totals.rows += built.rows;
        totals.bytes += Buffer.byteLength(serialized);
        const filePath = snapshotFilePath(snapshotsDir, provider, threadId);

        if (mode === "write") {
          // A baseline must not depend on the wall clock or on iteration
          // order: a second projection of the same rows has to match
          // byte-for-byte before it is worth writing down.
          const rebuilt = buildRowSnapshot(loaded, corpusThread, registry);
          expect(JSON.stringify(rebuilt.snapshot)).toBe(
            JSON.stringify(built.snapshot),
          );
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, serialized);
          return;
        }

        if (!fs.existsSync(filePath)) {
          throw new Error(
            `No row snapshot for ${threadId} at ${filePath}; run the suite once with BB_PROVIDER_CORPUS_SNAPSHOT=write`,
          );
        }
        const expected = normalizeJson(
          JSON.parse(fs.readFileSync(filePath, "utf8")),
        );
        const diffs = diffJson(expected, built.snapshot);
        const matched = applyAllowlist(
          allowlist,
          { provider, threadId },
          diffs,
        );
        for (const index of matched.usedEntryIndexes) {
          usedAllowlistEntries.add(index);
        }
        totals.allowedDiffs += matched.allowed.length;
        if (matched.unallowed.length > 0) {
          totals.diffThreads.push(threadId);
          if (totals.printedDiffThreads < PRINTED_DIFF_THREAD_LIMIT) {
            totals.printedDiffThreads += 1;
            console.log(
              [
                `Row snapshot diff for ${threadId} (${provider}): ${matched.unallowed.length} unallowed path(s)`,
                formatDiffs(matched.unallowed, 20),
                unifiedJsonDiff(
                  expected,
                  built.snapshot,
                  `${provider}/${threadId}`,
                ),
              ].join("\n"),
            );
          }
          throw new Error(
            `${threadId} (${provider}) has ${matched.unallowed.length} row diff(s) not covered by snapshots/allowlist.json; first: ${matched.unallowed[0]?.pointer}`,
          );
        }
      } finally {
        loaded.close();
      }
    },
    PER_THREAD_TIMEOUT_MS,
  );

  afterAll(() => {
    if (!available) {
      return;
    }
    const wallMs = Math.round(performance.now() - totals.startedAt);
    const megabytes = (totals.bytes / (1024 * 1024)).toFixed(1);
    // The vitest config silences console output of passing tests; stdout
    // still reaches the terminal, and the JSON file survives the run.
    process.stdout.write(
      `Row snapshots (${mode}): ${totals.threads} threads, ${totals.rows} rows, ${megabytes} MB, ${wallMs} ms\n`,
    );
    fs.mkdirSync(snapshotsDir, { recursive: true });
    fs.writeFileSync(
      path.join(snapshotsDir, "rows-last-run.json"),
      `${JSON.stringify(
        {
          mode,
          threads: totals.threads,
          rows: totals.rows,
          bytes: totals.bytes,
          wallMs,
          diffThreads: totals.diffThreads,
          allowedDiffs: totals.allowedDiffs,
        },
        null,
        2,
      )}\n`,
    );
    if (mode === "write") {
      return;
    }
    if (totals.diffThreads.length > 0) {
      console.log(
        `Row snapshot diffs in ${totals.diffThreads.length} thread(s): ${totals.diffThreads.join(", ")}`,
      );
    }
    const usedEntries = allowlist.filter((_, index) =>
      usedAllowlistEntries.has(index),
    );
    const unusedEntries = allowlist.filter(
      (_, index) => !usedAllowlistEntries.has(index),
    );
    if (usedEntries.length > 0) {
      console.log(
        `Allowlist entries used (${totals.allowedDiffs} diff paths):\n${usedEntries
          .map((entry) => `  ${describeAllowlistEntry(entry)}`)
          .join("\n")}`,
      );
    }
    if (unusedEntries.length > 0) {
      console.log(
        `Stale allowlist entries (matched nothing):\n${unusedEntries
          .map((entry) => `  ${describeAllowlistEntry(entry)}`)
          .join("\n")}`,
      );
    }
    // A filtered run (`-t thr_…`) leaves most entries legitimately unused.
    if (totals.threads === corpusThreads.length) {
      expect(
        unusedEntries.map((entry) => describeAllowlistEntry(entry)),
        "every snapshots/allowlist.json entry must cover at least one diff",
      ).toEqual([]);
    }
  });
});

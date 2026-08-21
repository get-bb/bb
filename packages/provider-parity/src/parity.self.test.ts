import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareParity,
  type ParityAllowlistEntry,
} from "@bb/provider-bridge-protocol/testing/parity";
import {
  RECORDINGS_ROOT,
  ROW_COUNTS_PATH,
  cellKey,
  compareCell,
  countCellInputs,
  isReplayable,
  listRecordedCells,
  readAllowlist,
  readBridgeRecording,
  recordedCellInputs,
  replayCell,
  type RowCountsEntry,
} from "./index.js";

/**
 * The CI-resident half of the parity oracle.
 *
 * Every committed recording is real provider traffic. Two things must hold
 * for each one, on every commit:
 *
 *   1. The recorded bridge output still assembles through the current delta
 *      assembler into a non-empty, schema-valid event stream, and projects to
 *      the pinned number of rows. `unhandled` and `grammarDrops` are pinned
 *      too and may only go down — a bridge change that makes the runtime drop
 *      one more event, or translate one fewer, fails here.
 *   2. Replaying the recording through the current bridge reproduces the
 *      recorded output: zero diffs in events, rows, and grammar drops. That
 *      is the `pnpm parity --old . --new .` acceptance run, in-process.
 *
 * Pin updates are deliberate: run with `UPDATE_PARITY_ROW_COUNTS=1`, read
 * the diff, and explain it in the PR.
 */

const cells = listRecordedCells(RECORDINGS_ROOT);
const checkoutRoot = new URL("../../..", import.meta.url).pathname;

function readPinned(): Record<string, RowCountsEntry> {
  if (!existsSync(ROW_COUNTS_PATH)) return {};
  return JSON.parse(readFileSync(ROW_COUNTS_PATH, "utf8")) as Record<string, RowCountsEntry>;
}

describe("recorded fixtures", () => {
  it("has every matrix provider", () => {
    const providers = new Set(cells.map((cell) => cell.provider));
    expect([...providers].sort()).toEqual(["acp-cursor", "claude-code", "codex", "pi"]);
  });

  it("assembles every cell to its pinned counts", () => {
    const pinned = readPinned();
    const actual: Record<string, RowCountsEntry> = {};
    const problems: string[] = [];
    const skipped: string[] = [];
    for (const cell of cells) {
      const key = cellKey(cell);
      const inputs = recordedCellInputs(cell);
      if (inputs.invalidDeltas.length > 0 && !isReplayable(cell.provider)) {
        // A lane recorded under a grammar this assembler no longer accepts,
        // for a provider whose bridge cannot be replayed (in-process SDK) and
        // so cannot be re-recorded (`pnpm rerecord`). Its pins stand until it
        // is re-recorded live; the cell is reported, not failed.
        skipped.push(`${key}: ${inputs.invalidDeltas.length} recorded thread/delta lines predate the current grammar`);
        if (pinned[key] !== undefined) actual[key] = pinned[key];
        continue;
      }
      if (inputs.invalidDeltas.length > 0) {
        problems.push(`${key}: ${inputs.invalidDeltas.length} thread/delta lines no longer parse: ${inputs.invalidDeltas[0]}`);
      }
      const counts = countCellInputs(inputs);
      actual[key] = counts;
      // A failure cell (a fork the agent refused) legitimately assembles to
      // nothing; the exact pin below is what guards against a stream that
      // silently went empty.
      const expected = pinned[key];
      if (expected === undefined) {
        problems.push(`${key}: not pinned in row-counts.json`);
        continue;
      }
      if (expected.events !== counts.events || expected.rows !== counts.rows) {
        problems.push(`${key}: ${counts.events} events/${counts.rows} rows, pinned ${expected.events}/${expected.rows}`);
      }
      if (counts.unhandled > expected.unhandled) {
        problems.push(`${key}: provider/unhandled rose from ${expected.unhandled} to ${counts.unhandled}`);
      }
      if (counts.grammarDrops > expected.grammarDrops) {
        problems.push(`${key}: grammar drops rose from ${expected.grammarDrops} to ${counts.grammarDrops}`);
      }
    }
    for (const key of Object.keys(pinned)) {
      if (!(key in actual)) problems.push(`${key}: pinned but no recording`);
    }
    if (skipped.length > 0) {
      console.warn(`recorded lanes awaiting a live re-recording:\n  ${skipped.join("\n  ")}`);
    }
    if (process.env.UPDATE_PARITY_ROW_COUNTS === "1") {
      writeFileSync(ROW_COUNTS_PATH, `${JSON.stringify(actual, null, 2)}\n`);
      return;
    }
    expect(problems).toEqual([]);
  });
});

describe("allowlist", () => {
  it("names a PR and a reason on every entry", () => {
    // Entries arrive with the migration PRs and describe the diff against
    // the pre-migration checkout (`pnpm parity --old <main> --new .`), which
    // reports an entry that masks nothing as stale. This self-suite replays
    // old == new, so it cannot judge staleness; it holds the entries to
    // their form.
    const allowlist = readAllowlist();
    for (const entry of allowlist) {
      expect(entry.pr).toMatch(/^#\d+$/);
      expect(entry.reason.trim().length).toBeGreaterThan(0);
      expect(entry.path.startsWith("/")).toBe(true);
    }
  });

  it("masks only what an entry names and reports unused entries as stale", () => {
    const events = [
      { type: "item/completed", threadId: "t", scope: { kind: "turn", turnId: "t1" }, item: { type: "agentMessage", id: "i1", text: "old" } },
    ];
    const changed = [
      { type: "item/completed", threadId: "t", scope: { kind: "turn", turnId: "t1" }, item: { type: "agentMessage", id: "i1", text: "new" } },
    ];
    const allowlist: ParityAllowlistEntry[] = [
      { provider: "*", cell: "*", layer: "events", path: "/*/item/text", pr: "#0", reason: "test" },
      { provider: "*", cell: "*", layer: "rows", path: "/*/nothing", pr: "#0", reason: "stale" },
      { provider: "other", cell: "*", layer: "events", path: "/*/item", pr: "#0", reason: "other provider" },
    ];
    const comparison = compareParity(
      { events: events as never, rows: [] },
      { events: changed as never, rows: [] },
      allowlist,
      { provider: "codex", cell: "turn-tools" },
    );
    expect(comparison.events).toEqual({ onlyInOld: [], onlyInNew: [] });
    expect(comparison.staleAllowlist.map((entry) => entry.reason)).toEqual(["stale"]);
    expect(comparison.passed).toBe(false);
  });
});

describe("replay through the current bridge", () => {
  const replayable = cells.filter(
    (cell) => isReplayable(cell.provider) && readBridgeRecording(cell.dir).manifest?.scope !== "process",
  );

  // Concurrent: each replay is its own bridge process with its own state
  // directory, and vitest's default concurrency keeps a handful in flight.
  it.concurrent.each(replayable.map((cell) => [cellKey(cell), cell] as const))(
    "%s reproduces its recording",
    async (_key, cell) => {
      const recorded = recordedCellInputs(cell);
      // Generous: a bridge process boots through tsx, and CI runners (and a
      // busy laptop) can take a while to spawn the first one.
      // This checkout's bridge wrote the current lane, so its gates are exact
      // for this replay; the recorded lane may predate its grammar.
      const replayed = await replayCell(cell, { checkoutRoot, timeoutMs: 60_000, planFromCurrentLane: true });
      expect(replayed.run.stalls).toEqual([]);
      const comparison = compareCell(cell, recorded, replayed, []);
      expect({
        events: comparison.events,
        rows: comparison.rows,
        grammar: comparison.grammar,
      }).toEqual({
        events: { onlyInOld: [], onlyInNew: [] },
        rows: { onlyInOld: [], onlyInNew: [] },
        grammar: { onlyInOld: [], onlyInNew: [] },
      });
      expect(replayed.events.length).toBe(recorded.events.length);
    },
    240_000,
  );
});

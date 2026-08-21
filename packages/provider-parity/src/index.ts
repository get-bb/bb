/**
 * `@bb/provider-parity`: the parity harness wired to the real delta assembler
 * and the real timeline projection, plus the per-cell runner the CLI and the
 * self-suite share. The harness itself lives in
 * `@bb/provider-bridge-protocol/testing/parity`; this package exists because
 * the assembler (`@bb/agent-runtime`) and the projection (`@bb/thread-view`)
 * both depend on the protocol package and cannot be imported from it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ThreadEvent } from "@bb/domain";
import { createBridgeDeltaEventCollector } from "@bb/agent-runtime/test/bridge-delta-assembly";
import {
  assembleRecordedEvents,
  compareParity,
  readBridgeRecording,
  replayRecording,
  resolveReplayProfile,
  UnreplayableProviderError,
  type CreateParityAssembler,
  type ParityAllowlistEntry,
  type ParityComparison,
  type ParityGrammarViolation,
  type ParityRowProjector,
  type ParityRun,
  type RecordedCell,
} from "@bb/provider-bridge-protocol/testing/parity";
import {
  buildThreadTimelineFromEvents,
  compactThreadTimelineSummaryEvents,
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
  type ThreadEventWithMeta,
} from "@bb/thread-view";

export {
  compareParity,
  listRecordedCells,
  readBridgeRecording,
  type ParityAllowlistEntry,
  type ParityComparison,
  type ParityRun,
  type RecordedCell,
} from "@bb/provider-bridge-protocol/testing/parity";

/** The committed fixtures, relative to this checkout. */
export const RECORDINGS_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../provider-bridge-protocol/recordings",
);

export const ALLOWLIST_PATH = join(RECORDINGS_ROOT, "parity-allowlist.json");
export const ROW_COUNTS_PATH = join(RECORDINGS_ROOT, "row-counts.json");

/** The runtime adapter's exact translation, coalescing disabled (see
 * `bridge-delta-assembly.ts`): one event per delta, deterministic ids. */
export const createParityAssembler: CreateParityAssembler = (providerId) => {
  const collector = createBridgeDeltaEventCollector(providerId);
  return { assembleMessage: (message) => collector.assembleMessage(message) };
};

const ROW_BASE_CREATED_AT = 1_700_000_000_000;
const excludedEventTypes = new Set<ThreadEvent["type"]>(THREAD_TIMELINE_EXCLUDED_EVENT_TYPES);

/**
 * Mirror `apps/server/src/services/threads/timeline.ts`: the latest page of
 * the thread, nested rows included so every projected row is compared, with
 * the noise events the server's event query excludes and the same summary
 * compaction pass. Metadata is synthesized in stream order.
 */
export const projectParityRows: ParityRowProjector = ({ events, providerId }) => {
  const withMeta: ThreadEventWithMeta[] = events
    .map((event, index) => ({
      event,
      meta: {
        id: `evt_${index + 1}`,
        seq: index + 1,
        createdAt: ROW_BASE_CREATED_AT + index,
      },
    }))
    .filter(({ event }) => !excludedEventTypes.has(event.type));
  const contextWindowEvents = withMeta.filter(
    ({ event }) => event.type === "thread/contextWindowUsage/updated",
  );
  const timeline = buildThreadTimelineFromEvents({
    acceptedClientRequestContext: {
      acceptedClientRequestEvents: [],
      rejectedClientRequestEvents: [],
    },
    contextWindowEvents,
    events: compactThreadTimelineSummaryEvents(withMeta),
    options: {
      includeProviderUnhandledOperations: true,
      includeNestedRows: true,
      isLatestPage: true,
      providerId,
      threadStatus: "idle",
      threadName: "parity",
      turnMessageDetail: "full",
      workspaceRoot: "/home/user/workspace",
    },
  });
  return JSON.parse(JSON.stringify(timeline.rows)) as unknown[];
};

export function readAllowlist(path: string = ALLOWLIST_PATH): ParityAllowlistEntry[] {
  if (!existsSync(path)) {
    return [];
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`${path}: expected a JSON array of allowlist entries`);
  }
  return parsed as ParityAllowlistEntry[];
}

export interface CellInputs {
  events: ThreadEvent[];
  rows: unknown[];
  grammarViolations: ParityGrammarViolation[];
}

/** The recording's own view: the recorded bridge output, no bridge in the loop. */
export function recordedCellInputs(cell: RecordedCell): CellInputs & { invalidDeltas: string[] } {
  const recording = readBridgeRecording(cell.dir);
  const assembled = assembleRecordedEvents(recording, createParityAssembler, cell.provider);
  return {
    ...assembled,
    rows: projectParityRows({ events: assembled.events, providerId: cell.provider }),
  };
}

export interface ReplayCellOptions {
  checkoutRoot: string;
  timeoutMs?: number;
  onStderr?: (text: string) => void;
  /** The leg's own assembler and projector (see `leg.ts`); defaults to this checkout's. */
  createAssembler?: CreateParityAssembler;
  projectRows?: ParityRowProjector;
}

export function isReplayable(providerId: string): boolean {
  try {
    resolveReplayProfile(providerId);
    return true;
  } catch (error) {
    if (error instanceof UnreplayableProviderError) return false;
    throw error;
  }
}

/** Replay one cell through the bridge of one checkout. */
export async function replayCell(
  cell: RecordedCell,
  options: ReplayCellOptions,
): Promise<CellInputs & { run: ParityRun }> {
  const projectRows = options.projectRows ?? projectParityRows;
  const run = await replayRecording({
    recordingDir: cell.dir,
    bridge: { checkoutRoot: options.checkoutRoot, providerId: cell.provider },
    createAssembler: options.createAssembler ?? createParityAssembler,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.onStderr !== undefined ? { onStderr: options.onStderr } : {}),
  });
  return {
    run,
    events: run.events,
    grammarViolations: run.grammarViolations,
    rows: projectRows({ events: run.events, providerId: cell.provider }),
  };
}

export function compareCell(
  cell: RecordedCell,
  oldInputs: CellInputs,
  newInputs: CellInputs,
  allowlist: readonly ParityAllowlistEntry[],
): ParityComparison {
  return compareParity(oldInputs, newInputs, allowlist, {
    provider: cell.provider,
    cell: cell.cell,
  });
}

/**
 * The per-cell counts pinned beside the recordings. `unhandled` and
 * `grammarDrops` are the two guardrails that may only go down (G11): events
 * a bridge could not translate, and events the runtime's grammar refused.
 */
export interface RowCountsEntry {
  events: number;
  rows: number;
  unhandled: number;
  grammarDrops: number;
}

export function countCellInputs(inputs: CellInputs): RowCountsEntry {
  return {
    events: inputs.events.length,
    rows: inputs.rows.length,
    unhandled: inputs.events.filter((event) => event.type === "provider/unhandled").length,
    grammarDrops: inputs.grammarViolations.length,
  };
}

export function cellKey(cell: RecordedCell): string {
  return `${cell.provider}/${cell.cell}`;
}

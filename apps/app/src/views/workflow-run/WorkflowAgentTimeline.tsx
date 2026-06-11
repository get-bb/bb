import { useMemo } from "react";
import type { ThreadEventRow } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import {
  buildThreadTimelineFromEvents,
  decodeThreadEventRow,
  EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { useWorkflowRunAgentEvents } from "@/hooks/queries/workflow-queries";
import { HttpError } from "@/lib/api";

/**
 * Render state of one agent's drill-in timeline. `missing` (404: the agent
 * has not started or the run dir was pruned) and `unavailable` (host offline)
 * are expected non-error conditions — the durable snapshot above still
 * renders, so neither may surface as a failure.
 */
export type WorkflowAgentTimelineState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ready"; isLive: boolean; rows: TimelineRow[] };

/**
 * Project a per-agent provider-event log into thread timeline rows with the
 * exact options the thread page and CLI use (the M2-locked drill-in
 * contract): empty thread-only contexts, nested rows inline (turn rows must
 * never lazy-fetch thread-scoped turn details for `wfa_` ids), and a null
 * workspace root.
 *
 * Decode is per-row tolerant, matching the server route's stance of skipping
 * unparsable JSONL lines: a stale SPA bundle meeting an event type a newer
 * server added must render the rows it understands, not crash the page.
 */
function buildAgentTimelineRows(rows: ThreadEventRow[]): TimelineRow[] {
  const events: ThreadEventWithMeta[] = [];
  for (const row of rows) {
    try {
      events.push(decodeThreadEventRow(row));
    } catch (error) {
      console.warn(
        "Skipping undecodable workflow agent event row",
        row.id,
        error,
      );
    }
  }
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: events,
    events,
    options: {
      includeDebugRawEvents: false,
      includeNestedRows: true,
      includeProviderUnhandledOperations: false,
      isLatestPage: true,
      threadStatus: "idle",
      turnMessageDetail: "full",
      workspaceRoot: null,
    },
  }).rows;
}

function classifyAgentTimelineError(error: unknown): WorkflowAgentTimelineState {
  if (error instanceof HttpError) {
    if (error.status === 404) {
      return { kind: "missing" };
    }
    if (error.status === 502 || error.status === 504) {
      return { kind: "unavailable" };
    }
    return { kind: "error", message: error.message };
  }
  return { kind: "error", message: "Failed to load the agent timeline." };
}

export function WorkflowAgentTimelineBody({
  state,
}: {
  state: WorkflowAgentTimelineState;
}) {
  switch (state.kind) {
    case "loading":
      return (
        <div className="flex flex-col gap-2 py-1">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/5" />
        </div>
      );
    case "missing":
      return (
        <EmptyState
          className="py-1"
          message="No timeline recorded for this agent yet."
        />
      );
    case "unavailable":
      return (
        <EmptyState
          className="py-1"
          icon="AlertCircle"
          message="Host offline — the agent timeline is unavailable until the host reconnects."
        />
      );
    case "error":
      return <EmptyState className="py-1" message={state.message} />;
    case "ready":
      if (state.rows.length === 0) {
        return (
          <EmptyState
            className="py-1"
            message="No timeline recorded for this agent yet."
          />
        );
      }
      return (
        <ThreadTimelineRows
          threadRuntimeDisplayStatus={state.isLive ? "active" : "idle"}
          timelineRows={state.rows}
          workspaceRootPath={undefined}
        />
      );
  }
}

export interface WorkflowAgentTimelineProps {
  /** Journal-stable 1-based display index (snapshot `agent.index`). */
  agentIndex: number;
  /** Streams shimmer/auto-expand affordances while the agent is running. */
  isAgentLive: boolean;
  runId: string;
}

export function WorkflowAgentTimeline({
  agentIndex,
  isAgentLive,
  runId,
}: WorkflowAgentTimelineProps) {
  const eventsQuery = useWorkflowRunAgentEvents({ agentIndex, runId });
  const rows = useMemo(
    () => (eventsQuery.data ? buildAgentTimelineRows(eventsQuery.data) : null),
    [eventsQuery.data],
  );

  const state: WorkflowAgentTimelineState = rows
    ? { kind: "ready", isLive: isAgentLive, rows }
    : eventsQuery.isError
      ? classifyAgentTimelineError(eventsQuery.error)
      : { kind: "loading" };

  return <WorkflowAgentTimelineBody state={state} />;
}

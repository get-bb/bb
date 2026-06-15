import { isSettledWorkflowAgentState } from "@bb/domain";
import type { TimelineRowStatus } from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import {
  durationDecoration,
  filterNull,
  makeTitle,
  segment,
} from "./timeline-title-helpers.js";
import type {
  TimelineTitle,
  TimelineTitleSegment,
} from "./timeline-row-title.js";
import type {
  TimelineViewDelegationWorkRow,
  TimelineViewWorkflowWorkRow,
} from "./timeline-view.js";

interface StatusVerb {
  text: string;
  shimmer: boolean;
}

function delegationVerbForStatus(status: TimelineRowStatus): StatusVerb {
  switch (status) {
    case "pending":
      return { text: "Running subagent:", shimmer: true };
    case "completed":
      return { text: "Ran subagent:", shimmer: false };
    case "error":
      return { text: "Failed subagent:", shimmer: false };
    case "interrupted":
      return { text: "Interrupted subagent:", shimmer: false };
    default:
      return assertNever(status);
  }
}

export function mapDelegationTitle(
  row: TimelineViewDelegationWorkRow,
): TimelineTitle {
  const description = row.description ?? (row.output.trim() || row.toolName);
  const verb = delegationVerbForStatus(row.status);
  const segments: TimelineTitleSegment[] = [
    segment(verb.text, { shimmer: verb.shimmer }),
    segment(description, { em: true, truncate: true }),
  ];
  if (row.subagentType) {
    segments.push(
      segment(`(${row.subagentType})`, { em: false, truncate: true }),
    );
  }
  // The verb prefix (Failed/Interrupted/Ran subagent) already conveys the
  // status, so the decoration only carries duration.
  return makeTitle({
    segments,
    decorations: filterNull([
      durationDecoration(row.startedAt, row.completedAt),
    ]),
  });
}

function workflowVerbForStatus(status: TimelineRowStatus): StatusVerb {
  switch (status) {
    case "pending":
      return { text: "Running workflow:", shimmer: true };
    case "completed":
      return { text: "Ran workflow:", shimmer: false };
    case "error":
      return { text: "Failed workflow:", shimmer: false };
    case "interrupted":
      return { text: "Interrupted workflow:", shimmer: false };
    default:
      return assertNever(status);
  }
}

function formatWorkflowAgentProgress(
  row: TimelineViewWorkflowWorkRow,
): string | null {
  const agents = row.workflow?.agents ?? [];
  if (agents.length === 0) {
    return null;
  }
  const done = agents.filter((agent) =>
    isSettledWorkflowAgentState(agent.state),
  ).length;
  return `(${done}/${agents.length} agents)`;
}

export function mapWorkflowTitle(
  row: TimelineViewWorkflowWorkRow,
): TimelineTitle {
  const verb = workflowVerbForStatus(row.status);
  const name = row.workflowName ?? row.description;
  const segments: TimelineTitleSegment[] = [
    segment(verb.text, { shimmer: verb.shimmer }),
    segment(name, { em: true, truncate: true }),
  ];
  const agentProgress = formatWorkflowAgentProgress(row);
  if (agentProgress) {
    segments.push(segment(agentProgress, { em: false }));
  }
  return makeTitle({
    segments,
    decorations: filterNull([
      durationDecoration(row.startedAt, row.completedAt),
    ]),
  });
}

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  isTerminalWorkflowRunStatus,
  type Host,
  type WorkflowAgentSnapshot,
  type WorkflowProgressSnapshot,
  type WorkflowRunStatus,
} from "@bb/domain";
import type { WorkflowRunResponse, WorkflowRunUsage } from "@bb/server-contract";
import { workflowRunDisplayState } from "@bb/thread-view";
import { WorkflowAgentTree } from "@/components/workflow/WorkflowAgentTree.js";
import { workflowRunStatusPillVariant } from "@/components/workflow/workflow-run-status.js";
import { Button } from "@/components/ui/button.js";
import { DetailCard, DetailRow } from "@/components/ui/detail-card.js";
import {
  ExpandablePanel,
  getCollapsibleHeaderToneClass,
} from "@/components/ui/disclosure.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { Pill } from "@/components/ui/pill.js";
import { getThreadRoutePath } from "@/lib/app-route-paths";

interface WorkflowRunStatusGlossArgs {
  isHostOffline: boolean;
  status: WorkflowRunStatus;
}

/**
 * The M4 CLI status glosses: the pre-running states otherwise read as a hang
 * (`created` runs are queued for host admission, `starting` runs have their
 * start command in flight). A host-offline run that claims to be live glosses
 * "runtime unknown" instead — the durable snapshot still renders, but the
 * status must not imply progress or a premature interruption.
 */
function workflowRunStatusGloss({
  isHostOffline,
  status,
}: WorkflowRunStatusGlossArgs): string | null {
  if (isHostOffline && (status === "starting" || status === "running")) {
    return "runtime unknown — host offline";
  }
  switch (status) {
    case "created":
      return "queued — starts when the host has capacity";
    case "starting":
      return "start command in flight to the host";
    default:
      return null;
  }
}

/**
 * Resume re-billing visibility: settled-`done` agents have completed journal
 * entries and replay free on resume; everything else re-runs.
 */
function describeCachedAgents(
  snapshot: WorkflowProgressSnapshot | null,
): string | null {
  if (snapshot === null || snapshot.agents.length === 0) {
    return null;
  }
  const cached = snapshot.agents.filter(
    (agent) => agent.state === "done",
  ).length;
  return `${cached} of ${snapshot.agents.length} agents cached`;
}

function formatRunDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return `${totalMinutes}m${seconds.toString().padStart(2, "0")}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes.toString().padStart(2, "0")}m`;
}

function formatRunUsage(usage: WorkflowRunUsage): string {
  return [
    `${usage.inputTokens.toLocaleString()} tokens in`,
    `${usage.outputTokens.toLocaleString()} tokens out`,
    `${usage.toolUses.toLocaleString()} ${usage.toolUses === 1 ? "tool use" : "tool uses"}`,
    formatRunDuration(usage.durationMs),
  ].join(" · ");
}

function formatRunExecution(run: WorkflowRunResponse): string {
  return [
    run.providerId,
    run.model ?? "provider default model",
    `${run.effort} effort`,
    run.sandbox,
  ].join(" · ");
}

function formatRunLimits(run: WorkflowRunResponse): string {
  return [
    `concurrency ${run.concurrency}`,
    `max agents ${run.maxAgents}`,
    `max fanout ${run.maxFanout}`,
    run.budgetOutputTokens === null
      ? "no output-token budget"
      : `${run.budgetOutputTokens.toLocaleString()} output-token budget`,
  ].join(" · ");
}

function formatJsonBlock(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function JsonBlock({ json }: { json: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-surface-raised px-2 py-1 font-mono text-xs leading-5 text-foreground">
      {formatJsonBlock(json)}
    </pre>
  );
}

interface AgentTimelinePanelProps {
  agent: WorkflowAgentSnapshot;
  renderAgentTimeline: (agent: WorkflowAgentSnapshot) => ReactNode;
}

function AgentTimelinePanel({
  agent,
  renderAgentTimeline,
}: AgentTimelinePanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <ExpandablePanel
      className="border border-border"
      headerToneClass={getCollapsibleHeaderToneClass(isExpanded)}
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded((expanded) => !expanded)}
      renderBody={() => renderAgentTimeline(agent)}
      summaryContent={
        <span className="text-xs">
          {agent.index}. {agent.label}
        </span>
      }
    />
  );
}

export interface WorkflowRunPageProps {
  /** Resolved host row; null while loading. Offline hosts mark the runtime unknown. */
  host: Host | null;
  isCancelPending: boolean;
  isResumePending: boolean;
  onCancel: () => void;
  onResume: () => void;
  /** Drill-in body for one agent — the container wires the per-agent event log query. */
  renderAgentTimeline: (agent: WorkflowAgentSnapshot) => ReactNode;
  run: WorkflowRunResponse;
  /** Preserved worktree branches collected from settled agent journal entries. */
  worktreeBranches: readonly string[];
}

export function WorkflowRunPage({
  host,
  isCancelPending,
  isResumePending,
  onCancel,
  onResume,
  renderAgentTimeline,
  run,
  worktreeBranches,
}: WorkflowRunPageProps) {
  const snapshot = run.progressSnapshot;
  const isHostOffline = host !== null && host.status !== "connected";
  const showCancel =
    run.retention === "live" && !isTerminalWorkflowRunStatus(run.status);
  const showResume = run.retention === "live" && run.status === "interrupted";
  const statusGloss = workflowRunStatusGloss({
    isHostOffline,
    status: run.status,
  });
  const cachedAgents = describeCachedAgents(snapshot);
  const agents = snapshot
    ? [...snapshot.agents].sort((a, b) => a.index - b.index)
    : [];

  return (
    <PageShell>
      <div className="flex flex-col gap-4 pt-3">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="min-w-0 truncate text-base font-medium text-foreground">
            {run.workflowName}
          </h1>
          <Pill variant={workflowRunStatusPillVariant(run.status)}>
            {run.status}
          </Pill>
          {statusGloss ? (
            <span className="text-xs text-muted-foreground">{statusGloss}</span>
          ) : null}
          {showCancel || showResume ? (
            <div className="ml-auto flex items-center gap-2">
              {showResume ? (
                <>
                  {cachedAgents ? (
                    <span className="text-xs text-muted-foreground">
                      {cachedAgents} — completed work replays free
                    </span>
                  ) : null}
                  <Button
                    disabled={isResumePending}
                    onClick={onResume}
                    size="sm"
                  >
                    {isResumePending ? "Resuming…" : "Resume"}
                  </Button>
                </>
              ) : null}
              {showCancel ? (
                <Button
                  disabled={isCancelPending}
                  onClick={onCancel}
                  size="sm"
                  variant="outline"
                >
                  {isCancelPending ? "Cancelling…" : "Cancel"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </header>

        <DetailCard labelWidth="112px">
          <DetailRow label="Workflow">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{run.workflowName}</span>
              <Pill variant="outline" className="shrink-0">
                {run.sourceTier}
              </Pill>
            </span>
          </DetailRow>
          <DetailRow label="Host">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{host?.name ?? run.hostId}</span>
              {isHostOffline ? (
                <Pill variant="outline" className="shrink-0">
                  offline
                </Pill>
              ) : null}
            </span>
          </DetailRow>
          <DetailRow label="Workspace" valueClassName="truncate">
            {run.workspacePath}
          </DetailRow>
          {run.anchorThreadId !== null ? (
            <DetailRow label="Anchor thread">
              <Link
                className="hover:underline"
                to={getThreadRoutePath({
                  projectId: run.projectId,
                  threadId: run.anchorThreadId,
                })}
              >
                {run.anchorThreadId}
              </Link>
            </DetailRow>
          ) : null}
          <DetailRow label="Execution">{formatRunExecution(run)}</DetailRow>
          <DetailRow label="Limits">{formatRunLimits(run)}</DetailRow>
          <DetailRow label="Usage">{formatRunUsage(run.usage)}</DetailRow>
          {worktreeBranches.length > 0 ? (
            <DetailRow label="Branches">
              {worktreeBranches.join(" · ")}
            </DetailRow>
          ) : null}
          {run.argsJson === null ? (
            <DetailRow label="Args" valueClassName="text-muted-foreground">
              none
            </DetailRow>
          ) : (
            <DetailRow label="Args" orientation="vertical">
              <JsonBlock json={run.argsJson} />
            </DetailRow>
          )}
          {run.failureReason !== null ? (
            <DetailRow label="Failure" valueClassName="text-destructive">
              {run.failureReason}
            </DetailRow>
          ) : null}
          {run.resultJson !== null ? (
            <DetailRow label="Result" orientation="vertical">
              <JsonBlock json={run.resultJson} />
            </DetailRow>
          ) : null}
        </DetailCard>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">Agents</h2>
          {snapshot !== null &&
          snapshot.agents.length + snapshot.phases.length > 0 ? (
            <>
              <div className="rounded-md border border-border bg-surface-raised px-2 py-1">
                <WorkflowAgentTree
                  runState={workflowRunDisplayState(run.status)}
                  snapshot={snapshot}
                />
              </div>
              {agents.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {agents.map((agent) => (
                    <AgentTimelinePanel
                      agent={agent}
                      key={agent.index}
                      renderAgentTimeline={renderAgentTimeline}
                    />
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <EmptyStatePanel>No progress reported yet.</EmptyStatePanel>
          )}
        </section>
      </div>
    </PageShell>
  );
}

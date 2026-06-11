import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  isTerminalWorkflowRunStatus,
  type Host,
  type WorkflowProgressSnapshot,
  type WorkflowRunStatus,
} from "@bb/domain";
import type { WorkflowRunResponse, WorkflowRunUsage } from "@bb/server-contract";
import { workflowRunDisplayState } from "@bb/thread-view";
import { workflowRunStatusPillVariant } from "@/components/workflow/workflow-run-status.js";
import { Button } from "@/components/ui/button.js";
import { DetailCard, DetailRow } from "@/components/ui/detail-card.js";
import {
  ExpandablePanel,
  getCollapsibleHeaderToneClass,
} from "@/components/ui/disclosure.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Pill } from "@/components/ui/pill.js";
import { getThreadRoutePath } from "@/lib/route-paths";
import { WorkflowAgentChatPanel } from "./WorkflowAgentChatPanel";
import { WorkflowRunAgentList } from "./WorkflowRunAgentList";

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

interface RunDetailsSectionProps {
  host: Host | null;
  isHostOffline: boolean;
  run: WorkflowRunResponse;
  worktreeBranches: readonly string[];
}

/**
 * The run's configuration/usage card, collapsed by default so the agent list
 * — the page's primary content — leads. Failure and result stay outside: a
 * failed run's reason and a finished run's result must not hide in a
 * disclosure.
 */
function RunDetailsSection({
  host,
  isHostOffline,
  run,
  worktreeBranches,
}: RunDetailsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <ExpandablePanel
      className="border border-border"
      headerToneClass={getCollapsibleHeaderToneClass(isExpanded)}
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded((expanded) => !expanded)}
      summaryContent={<span className="text-xs">Details</span>}
      renderBody={() => (
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
        </DetailCard>
      )}
    />
  );
}

function RunResultSection({ resultJson }: { resultJson: string }) {
  const [isExpanded, setIsExpanded] = useState(true);
  return (
    <ExpandablePanel
      className="border border-border"
      headerToneClass={getCollapsibleHeaderToneClass(isExpanded)}
      isExpanded={isExpanded}
      onToggle={() => setIsExpanded((expanded) => !expanded)}
      summaryContent={<span className="text-xs">Result</span>}
      renderBody={() => <JsonBlock json={resultJson} />}
    />
  );
}

export interface WorkflowAgentTimelineRenderArgs {
  /** Journal-stable 1-based display index (snapshot `agent.index`). */
  agentIndex: number;
  isAgentLive: boolean;
}

export interface WorkflowRunPageProps {
  /** Resolved host row; null while loading. Offline hosts mark the runtime unknown. */
  host: Host | null;
  isCancelPending: boolean;
  isResumePending: boolean;
  onCancel: () => void;
  /** Navigate back to the bare run route (deselect the agent). */
  onCloseAgent: () => void;
  onResume: () => void;
  /** Navigate to the agent drill-in sub-route. */
  onSelectAgent: (agentIndex: number) => void;
  /** Drill-in body for one agent — the container wires the per-agent event log query. */
  renderAgentTimeline: (args: WorkflowAgentTimelineRenderArgs) => ReactNode;
  run: WorkflowRunResponse;
  /** Agent open in the chat panel (from the URL), or null for the bare run route. */
  selectedAgentIndex: number | null;
  /** Preserved worktree branches collected from settled agent journal entries. */
  worktreeBranches: readonly string[];
}

/**
 * Workflow run detail, omegacode-viewer style: a fixed header bar, then a
 * resizable split with the phase/agent list on the left and — when an agent
 * is selected via the URL sub-route — that agent's chat timeline on the
 * right, rendered with the standard thread timeline components.
 */
export function WorkflowRunPage({
  host,
  isCancelPending,
  isResumePending,
  onCancel,
  onCloseAgent,
  onResume,
  onSelectAgent,
  renderAgentTimeline,
  run,
  selectedAgentIndex,
  worktreeBranches,
}: WorkflowRunPageProps) {
  const snapshot = run.progressSnapshot;
  const isHostOffline = host !== null && host.status !== "connected";
  const isRunLive = run.status === "starting" || run.status === "running";
  const showCancel =
    run.retention === "live" && !isTerminalWorkflowRunStatus(run.status);
  const showResume = run.retention === "live" && run.status === "interrupted";
  const statusGloss = workflowRunStatusGloss({
    isHostOffline,
    status: run.status,
  });
  const cachedAgents = describeCachedAgents(snapshot);
  const runState = workflowRunDisplayState(run.status);
  const selectedAgent =
    selectedAgentIndex !== null
      ? (snapshot?.agents.find((agent) => agent.index === selectedAgentIndex) ??
        null)
      : null;
  const isChatOpen = selectedAgentIndex !== null;

  const leftPanelContent = (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3 md:px-5">
      {run.failureReason !== null ? (
        <div className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {run.failureReason}
        </div>
      ) : null}
      <RunDetailsSection
        host={host}
        isHostOffline={isHostOffline}
        run={run}
        worktreeBranches={worktreeBranches}
      />
      {run.resultJson !== null ? (
        <RunResultSection resultJson={run.resultJson} />
      ) : null}
      {snapshot !== null &&
      snapshot.agents.length + snapshot.phases.length > 0 ? (
        <WorkflowRunAgentList
          onSelectAgent={onSelectAgent}
          runState={runState}
          selectedAgentIndex={selectedAgentIndex}
          snapshot={snapshot}
        />
      ) : (
        <EmptyStatePanel>No progress reported yet.</EmptyStatePanel>
      )}
    </div>
  );

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-clip md:-mx-5 md:-mb-5 md:-mt-5">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-hairline px-4 py-2.5 md:px-5">
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
                <Button disabled={isResumePending} onClick={onResume} size="sm">
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

      {isChatOpen ? (
        <PanelGroup
          direction="horizontal"
          className="min-h-0 min-w-0 flex-1"
          // react-resizable-panels sets an inline `overflow: hidden` that is
          // still programmatically scrollable; `clip` keeps the group a
          // non-scroll container (same guard as the thread detail panels).
          style={{ overflow: "clip" }}
        >
          <Panel
            id="workflow-run-agents-panel"
            defaultSize={45}
            minSize={25}
            order={1}
            className="min-w-0 overflow-clip"
          >
            {leftPanelContent}
          </Panel>
          <PanelResizeHandle className="group relative w-1.5 shrink-0">
            <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-hairline transition-colors group-hover:bg-accent-foreground/35 group-data-[resize-handle-active]:bg-accent-foreground/35" />
          </PanelResizeHandle>
          <Panel
            id="workflow-run-chat-panel"
            defaultSize={55}
            minSize={30}
            order={2}
            className="min-w-0 overflow-clip"
          >
            <WorkflowAgentChatPanel
              agent={selectedAgent}
              agentIndex={selectedAgentIndex}
              onClose={onCloseAgent}
              runState={runState}
            >
              {renderAgentTimeline({
                agentIndex: selectedAgentIndex,
                isAgentLive: isRunLive && selectedAgent?.state === "running",
              })}
            </WorkflowAgentChatPanel>
          </Panel>
        </PanelGroup>
      ) : (
        <div className="mx-auto min-h-0 w-full max-w-[760px] flex-1">
          {leftPanelContent}
        </div>
      )}
    </div>
  );
}

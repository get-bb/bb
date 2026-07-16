import { parseWorkflowSource } from "./parser.js";
import type { WorkflowRunInspection } from "./service.js";
import type {
  WorkflowCallView,
  WorkflowPhaseView,
  WorkflowRunView,
} from "./ui-contract.js";

const MAX_FALLBACK_LABEL_LENGTH = 80;

function fallbackCallLabel(prompt: string, index: number): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return `Agent ${index + 1}`;
  return normalized.length <= MAX_FALLBACK_LABEL_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_FALLBACK_LABEL_LENGTH - 1)}…`;
}

function callView(
  call: WorkflowRunInspection["calls"][number],
): WorkflowCallView {
  return {
    id: call.id,
    index: call.callIndex,
    label: call.options.title ?? fallbackCallLabel(call.prompt, call.callIndex),
    phase: call.options.phase,
    status: call.status,
    provider: call.execution.provider,
    model: call.execution.model,
    reasoningLevel: call.execution.reasoningLevel,
    cached: call.source === "cached",
    childThreadId: call.childThreadId,
    repairAttempts: call.repairAttempts,
    error: call.error,
    createdAt: call.createdAt,
    startedAt: call.startedAt,
    finishedAt: call.finishedAt,
  };
}

export function buildWorkflowRunView(
  run: WorkflowRunInspection,
): WorkflowRunView {
  const metadata = parseWorkflowSource(run.source).metadata;
  const calls = run.calls.map(callView);
  const declaredPhaseTitles = new Set(
    metadata.phases.map((phase) => phase.title),
  );
  const undeclaredPhaseTitles: string[] = [];
  const seenUndeclaredPhaseTitles = new Set<string>();
  for (const call of calls) {
    if (
      call.phase !== null &&
      !declaredPhaseTitles.has(call.phase) &&
      !seenUndeclaredPhaseTitles.has(call.phase)
    ) {
      seenUndeclaredPhaseTitles.add(call.phase);
      undeclaredPhaseTitles.push(call.phase);
    }
  }
  if (
    run.phase !== null &&
    !declaredPhaseTitles.has(run.phase) &&
    !seenUndeclaredPhaseTitles.has(run.phase)
  ) {
    undeclaredPhaseTitles.push(run.phase);
  }
  const phases: WorkflowPhaseView[] = [
    ...metadata.phases.map((phase) => ({
      title: phase.title,
      detail: phase.detail,
      calls: calls.filter((call) => call.phase === phase.title),
    })),
    ...undeclaredPhaseTitles.map((title) => ({
      title,
      detail: null,
      calls: calls.filter((call) => call.phase === title),
    })),
  ];

  return {
    id: run.id,
    name: run.name,
    description: metadata.description,
    status: run.status,
    currentPhase: run.phase,
    phases,
    unphasedCalls: calls.filter((call) => call.phase === null),
    resultAvailable: run.status === "succeeded" && run.resultJson !== null,
    error: run.error,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

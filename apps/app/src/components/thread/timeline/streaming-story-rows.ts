import type { TimelineRow } from "@bb/server-contract";

export interface ExplorationStep {
  callId: string;
  intent:
    | { type: "read"; path: string }
    | { type: "search"; query: string; path: string }
    | { type: "list_files"; path: string };
}

export function explorationRow(
  step: ExplorationStep,
  seq: number,
  ids: { idPrefix: string; threadId: string; turnId: string },
): TimelineRow {
  const base = {
    id: `${ids.idPrefix}:${step.callId}`,
    threadId: ids.threadId,
    turnId: ids.turnId,
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
    kind: "work" as const,
    status: "completed" as const,
    callId: step.callId,
    cmd: null,
    completedAt: seq,
  };
  switch (step.intent.type) {
    case "read":
      return { ...base, workKind: "file-read", path: step.intent.path };
    case "search":
      return {
        ...base,
        workKind: "search",
        mode: "content",
        query: step.intent.query,
        path: step.intent.path,
      };
    case "list_files":
      return {
        ...base,
        workKind: "search",
        mode: "list",
        query: "",
        path: step.intent.path,
      };
  }
}

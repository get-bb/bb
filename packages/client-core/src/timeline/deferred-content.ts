import type { TimelineRow } from "@bb/server-contract";
import type { ThreadTimelineViewRow } from "@bb/thread-view";

export function deferredTimelineContentItemId(
  row: ThreadTimelineViewRow,
): string | null {
  if (row.kind === "work" && "contentDeferred" in row && row.contentDeferred) {
    return "callId" in row ? row.callId : null;
  }
  if (
    row.kind === "system" &&
    row.systemKind === "operation" &&
    row.operationKind !== "parent-change" &&
    row.contentDeferred === true
  ) {
    return row.reasoningId ?? null;
  }
  return null;
}

function findLoadedRow(
  row: ThreadTimelineViewRow,
  itemId: string,
  loaded: readonly TimelineRow[],
): TimelineRow | null {
  const byId = loaded.find((candidate) => candidate.id === row.id);
  if (byId !== undefined) {
    return byId;
  }
  return (
    loaded.find((candidate) => {
      if (row.kind === "system") {
        return (
          candidate.kind === "system" &&
          "reasoningId" in candidate &&
          candidate.reasoningId === itemId
        );
      }
      if (
        row.kind !== "work" ||
        candidate.kind !== "work" ||
        candidate.workKind !== row.workKind ||
        !("callId" in candidate) ||
        candidate.callId !== itemId
      ) {
        return false;
      }
      return (
        row.workKind !== "file-change" ||
        (candidate.workKind === "file-change" &&
          candidate.change.path === row.change.path)
      );
    }) ?? null
  );
}

export function resolveDeferredTimelineContent(
  row: ThreadTimelineViewRow,
  loaded: readonly TimelineRow[],
): ThreadTimelineViewRow | null {
  const itemId = deferredTimelineContentItemId(row);
  if (itemId === null) {
    return row;
  }
  const match = findLoadedRow(row, itemId, loaded);
  if (match === null) {
    return null;
  }
  if (
    row.kind === "system" &&
    row.systemKind === "operation" &&
    row.operationKind !== "parent-change" &&
    match.kind === "system"
  ) {
    const { contentDeferred: _contentDeferred, ...rest } = row;
    return { ...rest, detail: match.detail };
  }
  if (row.kind !== "work" || match.kind !== "work") {
    return null;
  }
  if (row.workKind === "command" && match.workKind === "command") {
    const { contentDeferred: _contentDeferred, ...rest } = row;
    return {
      ...rest,
      command: match.command,
      output: match.output,
      ...(match.outputPreview === undefined
        ? {}
        : { outputPreview: match.outputPreview }),
    };
  }
  if (row.workKind === "tool" && match.workKind === "tool") {
    const { contentDeferred: _contentDeferred, ...rest } = row;
    return {
      ...rest,
      output: match.output,
      ...(match.outputPreview === undefined
        ? {}
        : { outputPreview: match.outputPreview }),
    };
  }
  if (row.workKind === "file-change" && match.workKind === "file-change") {
    const { contentDeferred: _contentDeferred, ...rest } = row;
    return {
      ...rest,
      change: match.change,
      stderr: match.stderr,
      stdout: match.stdout,
    };
  }
  return null;
}

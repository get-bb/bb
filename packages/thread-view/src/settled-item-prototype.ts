import type { ThreadEvent } from "@bb/domain";
import {
  buildSettledItemMessages,
  type ThreadEventWithMeta,
} from "./build-event-projection.js";
import type { BuildEventProjectionMessagesOptions } from "./event-projection-message.js";
import { encodeSettledItem } from "./settled-item.js";

export interface SettledItemCandidate {
  ownerId: string;
  sequence: number;
  removedIds: string[];
  data: string | null;
}

function itemId(event: ThreadEvent): string | null {
  if (event.type === "item/started" || event.type === "item/completed")
    return event.item.id;
  if (
    event.type === "item/commandExecution/outputDelta" ||
    event.type === "item/agentMessage/delta" ||
    event.type === "item/fileChange/outputDelta" ||
    event.type === "item/reasoning/summaryTextDelta" ||
    event.type === "item/reasoning/textDelta"
  )
    return event.itemId;
  return null;
}

function key(threadId: string, turnId: string, id: string): string {
  return JSON.stringify([threadId, turnId, id]);
}

function crossesBoundary(
  boundaries: readonly number[],
  start: number,
  end: number,
): boolean {
  let low = 0;
  let high = boundaries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (boundaries[middle] <= start) low = middle + 1;
    else high = middle;
  }
  return low < boundaries.length && boundaries[low] <= end;
}

export function findSettledItemCandidates(
  events: ThreadEventWithMeta[],
  options: Omit<BuildEventProjectionMessagesOptions, "settledItems">,
): SettledItemCandidate[] {
  const groups = new Map<string, ThreadEventWithMeta[]>();
  const turnStarts = new Map<string, number>();
  const turnEnds = new Map<string, number>();
  const boundaries: number[] = [];
  const kinds = new Map<string, string>([
    ["commandExecution", "command"],
    ["agentMessage", "assistant-text"],
    ["fileChange", "file-edit"],
    ["reasoning", "operation"],
  ]);
  for (const row of events) {
    const { event, meta } = row;
    if (
      event.type === "client/turn/requested" ||
      event.type === "thread/context/cleared" ||
      event.type === "system/manager/user_message" ||
      (event.type === "item/completed" && event.item.type === "userMessage")
    )
      boundaries.push(meta.seq);
    if (event.scope.kind !== "turn") continue;
    const turnKey = key(event.threadId, event.scope.turnId, "");
    if (event.type === "turn/started")
      turnStarts.set(turnKey, Math.max(turnStarts.get(turnKey) ?? 0, meta.seq));
    if (event.type === "turn/completed")
      turnEnds.set(turnKey, Math.max(turnEnds.get(turnKey) ?? 0, meta.seq));
    const id = itemId(event);
    if (id === null) continue;
    const groupKey = key(event.threadId, event.scope.turnId, id);
    const group = groups.get(groupKey) ?? [];
    group.push(row);
    groups.set(groupKey, group);
  }
  boundaries.sort((a, b) => a - b);
  const candidates: SettledItemCandidate[] = [];
  const messages = buildSettledItemMessages(events, options);
  const byEnd = new Map<number, typeof messages>();
  const byStart = new Map<number, typeof messages>();
  for (const message of messages) {
    const entries = byEnd.get(message.sourceSeqEnd) ?? [];
    entries.push(message);
    byEnd.set(message.sourceSeqEnd, entries);
    const starts = byStart.get(message.sourceSeqStart) ?? [];
    starts.push(message);
    byStart.set(message.sourceSeqStart, starts);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.meta.seq - b.meta.seq);
    const end = group[group.length - 1];
    const matches = byEnd.get(end.meta.seq);
    if (
      !matches?.length &&
      end.event.type === "item/completed" &&
      end.event.scope.kind === "turn" &&
      (end.event.item.type === "reasoning" ||
        end.event.item.type === "agentMessage") &&
      group.length > 1 &&
      group.length <= 500
    ) {
      const turnKey = key(end.event.threadId, end.event.scope.turnId, "");
      const empty = group.every(({ event }) => {
        if (event.type === "item/started" || event.type === "item/completed") {
          return event.item.type === "reasoning"
            ? event.item.summary.join("") === "" &&
                event.item.content.join("") === ""
            : event.item.type === "agentMessage" && event.item.text === "";
        }
        return (
          (event.type === "item/agentMessage/delta" ||
            event.type === "item/reasoning/textDelta" ||
            event.type === "item/reasoning/summaryTextDelta") &&
          event.delta === ""
        );
      });
      if (
        empty &&
        group.filter((row) => row.event.type === "item/completed").length ===
          1 &&
        group.filter((row) => row.event.type === "item/started").length <= 1 &&
        (turnStarts.get(turnKey) ?? Infinity) < group[0].meta.seq &&
        (turnEnds.get(turnKey) ?? 0) > end.meta.seq &&
        !crossesBoundary(boundaries, group[0].meta.seq, end.meta.seq)
      ) {
        candidates.push({
          ownerId: end.meta.id,
          sequence: end.meta.seq,
          removedIds: group.slice(0, -1).map((row) => row.meta.id),
          data: null,
        });
      }
      continue;
    }
    if (matches?.length !== 1) continue;
    const message = matches[0];
    if (
      group.some((row) =>
        byStart.get(row.meta.seq)?.some((other) => other !== message),
      )
    )
      continue;
    if (message.scope.kind !== "turn") continue;
    if (group.length < 2 || group.length > 500) continue;
    const first = group[0];
    const last = group[group.length - 1];
    if (last.event.type !== "item/completed") continue;
    const itemType = last.event.item.type;
    const expectedKind = kinds.get(itemType);
    if (expectedKind !== message.kind) continue;
    if (
      group.filter((row) => row.event.type === "item/completed").length !== 1 ||
      group.filter((row) => row.event.type === "item/started").length > 1 ||
      group.some(
        (row) =>
          (row.event.type === "item/started" ||
            row.event.type === "item/completed") &&
          row.event.item.type !== itemType,
      )
    )
      continue;
    if (last.event.item.type === "commandExecution") {
      if (
        message.kind !== "command" ||
        message.output !== (last.event.item.aggregatedOutput ?? "")
      )
        continue;
      if (
        last.event.item.status !== "completed" &&
        last.event.item.status !== "failed" &&
        last.event.item.status !== "interrupted"
      )
        continue;
      if (
        (last.event.item.status === "failed"
          ? "error"
          : last.event.item.status) !== message.status
      )
        continue;
    }
    const turnKey = key(message.threadId, message.scope.turnId, "");
    if (
      (turnStarts.get(turnKey) ?? Infinity) >= first.meta.seq ||
      (turnEnds.get(turnKey) ?? 0) <= last.meta.seq
    )
      continue;
    if (
      first.meta.seq > message.sourceSeqStart ||
      last.meta.seq !== message.sourceSeqEnd
    )
      continue;
    if (crossesBoundary(boundaries, first.meta.seq, last.meta.seq)) continue;
    const details =
      message.kind === "command" ? { ...message, output: undefined } : message;
    if (JSON.stringify({ version: 1, message: details }).length > 256_000)
      continue;
    const toolFlushSequences =
      message.kind === "file-edit"
        ? group.map((row) => row.meta.seq)
        : message.kind === "assistant-text"
          ? [
              group.find(
                (row) =>
                  (row.event.type === "item/agentMessage/delta" &&
                    row.event.delta.includes("\n")) ||
                  (row.event.type === "item/completed" &&
                    row.event.item.type === "agentMessage" &&
                    row.event.item.text.length > 0),
              )?.meta.seq ?? last.meta.seq,
            ]
          : [];
    const data = encodeSettledItem(
      message,
      last.event.item.type === "commandExecution"
        ? last.event.item.truncation?.aggregatedOutput
        : undefined,
      toolFlushSequences,
    );
    candidates.push({
      ownerId: last.meta.id,
      sequence: first.meta.seq,
      removedIds: group.slice(0, -1).map((row) => row.meta.id),
      data,
    });
  }
  return candidates;
}

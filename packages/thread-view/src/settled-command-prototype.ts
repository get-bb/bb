import type { ThreadEvent } from "@bb/domain";
import {
  buildSettledCommandMessages,
  type ThreadEventWithMeta,
} from "./build-event-projection.js";
import type { BuildEventProjectionMessagesOptions } from "./event-projection-message.js";
import { encodeSettledCommand } from "./settled-command.js";

export interface SettledCommandCandidate {
  ownerId: string;
  sequence: number;
  removedIds: string[];
  data: string;
}

function itemId(event: ThreadEvent): string | null {
  if (event.type === "item/started" || event.type === "item/completed")
    return event.item.id;
  if (event.type === "item/commandExecution/outputDelta") return event.itemId;
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

export function findSettledCommandCandidates(
  events: ThreadEventWithMeta[],
  options: Omit<BuildEventProjectionMessagesOptions, "settledCommands">,
): SettledCommandCandidate[] {
  const groups = new Map<string, ThreadEventWithMeta[]>();
  const turnStarts = new Map<string, number>();
  const turnEnds = new Map<string, number>();
  const boundaries: number[] = [];
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
  const candidates: SettledCommandCandidate[] = [];
  const messages = buildSettledCommandMessages(events, options);
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const message of messages) {
    if (message.scope.kind !== "turn") continue;
    const id = key(message.threadId, message.scope.turnId, message.callId);
    if (seen.has(id)) duplicate.add(id);
    seen.add(id);
  }
  for (const message of messages) {
    if (message.scope.kind !== "turn") continue;
    const groupKey = key(
      message.threadId,
      message.scope.turnId,
      message.callId,
    );
    if (duplicate.has(groupKey)) continue;
    const group = groups.get(groupKey);
    if (!group || group.length < 2 || group.length > 500) continue;
    group.sort((a, b) => a.meta.seq - b.meta.seq);
    const first = group[0];
    const last = group[group.length - 1];
    if (
      last.event.type !== "item/completed" ||
      last.event.item.type !== "commandExecution"
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
    if (
      group.filter((row) => row.event.type === "item/completed").length !== 1 ||
      group.filter((row) => row.event.type === "item/started").length > 1
    )
      continue;
    if (
      group.some(
        (row) =>
          (row.event.type === "item/started" ||
            row.event.type === "item/completed") &&
          row.event.item.type !== "commandExecution",
      )
    )
      continue;
    const turnKey = key(message.threadId, message.scope.turnId, "");
    if (
      (turnStarts.get(turnKey) ?? Infinity) >= first.meta.seq ||
      (turnEnds.get(turnKey) ?? 0) <= last.meta.seq
    )
      continue;
    if (
      first.meta.seq !== message.sourceSeqStart ||
      last.meta.seq !== message.sourceSeqEnd ||
      message.output !== (last.event.item.aggregatedOutput ?? "")
    )
      continue;
    if (crossesBoundary(boundaries, first.meta.seq, last.meta.seq)) continue;
    const { output: _output, ...details } = message;
    if (JSON.stringify({ version: 1, message: details }).length > 256_000)
      continue;
    const data = encodeSettledCommand(message);
    candidates.push({
      ownerId: last.meta.id,
      sequence: first.meta.seq,
      removedIds: group.slice(0, -1).map((row) => row.meta.id),
      data,
    });
  }
  return candidates;
}

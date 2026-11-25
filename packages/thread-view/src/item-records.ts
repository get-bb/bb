import {
  getThreadEventScopeTurnId,
  isApprovalInteractionLifecycle,
  parseLegacyImageGenerationCompletion,
  type ThreadEvent,
  type ThreadEventItem,
  type ThreadEventItemPresentation,
} from "@bb/domain";
import type { EventProjectionMessage } from "./event-projection-message.js";
import type { ThreadEventWithMeta } from "./group-event-projection-turns.js";

export type ItemRecordTextKind = "assistant" | "reasoning";

export interface ItemRecordPoint {
  seq: number;
  createdAt: number;
}

export interface ItemRecordStop extends ItemRecordPoint {
  interrupted: boolean;
}

export interface ItemRecordFileRow {
  key: string;
  matchKeys: string[];
  start: ItemRecordPoint;
}

export interface ItemRecord {
  threadId: string;
  itemId: string;
  item: ThreadEventItem | null;
  firstItem: ThreadEventItem | null;
  textKind: ItemRecordTextKind | null;
  textKey: string | null;
  outputKind: "command" | "file-change" | "tool" | null;
  finished: boolean;
  hasStartedEvent: boolean;
  turnId: string | undefined;
  parentToolCallId: string | undefined;
  start: ItemRecordPoint;
  startedAt: number;
  end: ItemRecordPoint;
  completion: ItemRecordPoint | null;
  textStart: ItemRecordPoint | null;
  textEnd: ItemRecordPoint | null;
  text: string;
  output: string;
  lateOutput: string;
  flushedOutputLength: number;
  description: string | null;
  reasoningSummary: string;
  reasoningContent: string;
  fileRows: ItemRecordFileRow[];
  fileRowIndexes: number[];
  foreignFileKeys: ReadonlySet<string>;
  progress: string | null;
  firstPresentation: ThreadEventItemPresentation | undefined;
  stop: ItemRecordStop | null;
  dropped: boolean;
  version: number;
  formatted: {
    version: number;
    settled: boolean;
    messages: EventProjectionMessage[];
  } | null;
}

export interface ItemRecordStore {
  records: ItemRecord[];
  currentByItemId: Map<string, ItemRecord>;
  openText: Set<ItemRecord>;
  openOutput: Set<ItemRecord>;
  textKeys: Set<string>;
  finalActivityIds: Set<string>;
}

export type ItemEventRole =
  | {
      kind: "item";
      itemId: string;
      item: ThreadEventItem;
      completes: boolean;
      carriesOver: boolean;
    }
  | {
      kind: "text";
      itemId: string;
      textKind: ItemRecordTextKind;
      delta: string;
    }
  | {
      kind: "output";
      itemId: string;
      outputKind: "command" | "file-change";
      delta: string;
      reset: boolean;
    }
  | { kind: "progress"; itemId: string; message: string }
  | { kind: "approval"; itemId: string; item: ThreadEventItem }
  | { kind: "compaction"; itemId: string; completes: boolean }
  | { kind: "ignored" };

interface ApplyItemEventContext {
  parentToolCallId: string | undefined;
  turnClosed: boolean;
}

const ACTIVITY_ITEM_TYPES: ReadonlySet<ThreadEventItem["type"]> = new Set([
  "webSearch",
  "webFetch",
  "imageView",
  "imageGeneration",
  "fileRead",
  "search",
  "planSteps",
  "extension",
]);

export function createItemRecordStore(): ItemRecordStore {
  return {
    records: [],
    currentByItemId: new Map(),
    openText: new Set(),
    openOutput: new Set(),
    textKeys: new Set(),
    finalActivityIds: new Set(),
  };
}

function isSuppressedItem(item: ThreadEventItem): boolean {
  switch (item.type) {
    case "toolCall":
    case "fileRead":
    case "search":
    case "planSteps":
    case "extension":
    case "delegation":
    case "fileChange":
      return (
        item.presentation?.suppress === true &&
        (item.status === "pending" || item.status === "completed")
      );
    default:
      return false;
  }
}

function itemRole(
  item: ThreadEventItem,
  completes: boolean,
  carriesOver: boolean,
): ItemEventRole | null {
  if (item.type === "userMessage") {
    return null;
  }
  if (item.type === "contextCompaction") {
    return { kind: "compaction", itemId: item.id, completes };
  }
  if (isSuppressedItem(item)) {
    return { kind: "ignored" };
  }
  return { kind: "item", itemId: item.id, item, completes, carriesOver };
}

function approvalRole(
  event: Extract<ThreadEvent, { type: "system/interaction/lifecycle" }>,
): ItemEventRole | null {
  const interaction = event.interaction;
  if (
    !isApprovalInteractionLifecycle(interaction) ||
    interaction.status !== "resolved" ||
    (interaction.resolution?.decision !== "allow_once" &&
      interaction.resolution?.decision !== "allow_for_session") ||
    interaction.payload.subject.kind !== "command"
  ) {
    return null;
  }
  const subject = interaction.payload.subject;
  return {
    kind: "approval",
    itemId: subject.itemId,
    item: {
      type: "commandExecution",
      id: subject.itemId,
      command: subject.command,
      cwd: subject.cwd ?? "",
      status: "pending",
      approvalStatus: null,
    },
  };
}

function legacyImageGenerationRole(
  event: Extract<ThreadEvent, { type: "provider/unhandled" }>,
): ItemEventRole | null {
  const legacy = parseLegacyImageGenerationCompletion(event);
  if (legacy === null) {
    return null;
  }
  return {
    kind: "item",
    itemId: legacy.callId,
    completes: true,
    carriesOver: false,
    item: {
      type: "imageGeneration",
      id: legacy.callId,
      status: legacy.status,
      prompt: legacy.prompt,
      path: legacy.path,
      error: legacy.error,
      transparentBackground: legacy.transparentBackground,
      ...(event.parentToolCallId
        ? { parentToolCallId: event.parentToolCallId }
        : {}),
    },
  };
}

export function classifyItemEvent(event: ThreadEvent): ItemEventRole | null {
  switch (event.type) {
    case "item/started":
      return itemRole(event.item, false, false);
    case "item/completed":
      return itemRole(event.item, true, true);
    case "item/delegation/progress":
    case "item/backgroundTask/progress":
      return itemRole(event.item, false, true);
    case "item/delegation/completed":
    case "item/backgroundTask/completed":
      return itemRole(event.item, true, true);
    case "item/agentMessage/delta":
    case "item/plan/delta":
      return {
        kind: "text",
        itemId: event.itemId,
        textKind: "assistant",
        delta: event.delta,
      };
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
      return {
        kind: "text",
        itemId: event.itemId,
        textKind: "reasoning",
        delta: event.delta,
      };
    case "item/commandExecution/outputDelta":
      return {
        kind: "output",
        itemId: event.itemId,
        outputKind: "command",
        delta: event.delta,
        reset: event.reset === true,
      };
    case "item/fileChange/outputDelta":
      return {
        kind: "output",
        itemId: event.itemId,
        outputKind: "file-change",
        delta: event.delta,
        reset: false,
      };
    case "item/toolCall/progress":
    case "item/mcpToolCall/progress":
      return {
        kind: "progress",
        itemId: event.itemId,
        message: event.message ?? "Progress update",
      };
    case "system/interaction/lifecycle":
      return approvalRole(event);
    case "provider/unhandled":
      return legacyImageGenerationRole(event);
    default:
      return null;
  }
}

function itemTextKind(item: ThreadEventItem | null): ItemRecordTextKind | null {
  switch (item?.type) {
    case "agentMessage":
    case "plan":
      return "assistant";
    case "reasoning":
      return "reasoning";
    default:
      return null;
  }
}

function itemParentToolCallId(
  item: ThreadEventItem | null,
): string | undefined {
  return item && "parentToolCallId" in item ? item.parentToolCallId : undefined;
}

function createRecord(
  store: ItemRecordStore,
  entry: ThreadEventWithMeta,
  itemId: string,
  textKind: ItemRecordTextKind | null,
  item: ThreadEventItem | null,
  context: ApplyItemEventContext,
): ItemRecord {
  const at = { seq: entry.meta.seq, createdAt: entry.meta.createdAt };
  const turnId = getThreadEventScopeTurnId(entry.event.scope);
  const record: ItemRecord = {
    threadId: entry.event.threadId,
    itemId,
    item: null,
    firstItem: null,
    textKind,
    textKey: null,
    outputKind: null,
    finished: false,
    hasStartedEvent: false,
    turnId,
    parentToolCallId: context.parentToolCallId,
    start: at,
    startedAt: at.createdAt,
    end: at,
    completion: null,
    textStart: null,
    textEnd: null,
    text: "",
    output: "",
    lateOutput: "",
    flushedOutputLength: 0,
    description: null,
    reasoningSummary: "",
    reasoningContent: "",
    fileRows: [],
    fileRowIndexes: [],
    foreignFileKeys: new Set(),
    progress: null,
    firstPresentation: undefined,
    stop: null,
    dropped: false,
    version: 0,
    formatted: null,
  };
  if (textKind !== null) {
    const parent =
      context.parentToolCallId ?? itemParentToolCallId(item) ?? null;
    record.textKey =
      turnId === undefined
        ? null
        : `kind:${textKind}|turn:${turnId}|parent:${parent ?? "root"}|item:${itemId}`;
    record.dropped =
      record.textKey === null ||
      store.textKeys.has(record.textKey) ||
      (textKind === "reasoning" && context.turnClosed);
    if (!record.dropped && record.textKey !== null) {
      store.textKeys.add(record.textKey);
      store.openText.add(record);
    }
  }
  store.records.push(record);
  store.currentByItemId.set(itemId, record);
  return record;
}

function isClosed(record: ItemRecord): boolean {
  return record.finished || record.stop !== null || record.dropped;
}

function continuesClosedRecord(
  record: ItemRecord,
  role: ItemEventRole,
): boolean {
  if (role.kind === "output") {
    return record.finished;
  }
  if (role.kind !== "item") {
    return false;
  }
  return role.carriesOver || record.item?.type === "delegation";
}

function startsNewRecord(
  record: ItemRecord,
  role: ItemEventRole,
  turnId: string | undefined,
): boolean {
  if (record.item?.type === "backgroundTask") {
    return false;
  }
  if (record.textKind !== null || record.item?.type === "fileChange") {
    return (
      record.turnId !== undefined &&
      turnId !== undefined &&
      turnId !== record.turnId
    );
  }
  return isClosed(record) && !continuesClosedRecord(record, role);
}

function fileChangeMatchKeys(change: {
  path: string;
  movePath?: string | null;
}): string[] {
  return change.movePath && change.movePath !== change.path
    ? [change.path, change.movePath]
    : [change.path];
}

function matchFileRows(
  record: ItemRecord,
  item: Extract<ThreadEventItem, { type: "fileChange" }>,
  at: ItemRecordPoint,
): void {
  const used = new Set<number>();
  const identityCounts = new Map<string, number>();
  const rowsByPath = new Map<string, number[]>();
  for (let index = record.fileRows.length - 1; index >= 0; index--) {
    for (const path of record.fileRows[index]!.matchKeys) {
      const candidates = rowsByPath.get(path);
      if (candidates === undefined) {
        rowsByPath.set(path, [index]);
      } else {
        candidates.push(index);
      }
    }
  }
  record.fileRowIndexes = item.changes.map((change) => {
    const matchKeys = fileChangeMatchKeys(change);
    let existing = -1;
    for (const path of matchKeys) {
      const candidates = rowsByPath.get(path);
      if (candidates === undefined) continue;
      let candidate = candidates.at(-1);
      while (candidate !== undefined && used.has(candidate)) {
        candidates.pop();
        candidate = candidates.at(-1);
      }
      if (
        candidate !== undefined &&
        (existing === -1 || candidate < existing)
      ) {
        existing = candidate;
      }
    }
    if (existing !== -1) {
      used.add(existing);
      const row = record.fileRows[existing]!;
      row.matchKeys = [...new Set([...row.matchKeys, ...matchKeys])];
      return existing;
    }
    const identity = change.movePath ?? change.path;
    const count = identityCounts.get(identity) ?? 0;
    identityCounts.set(identity, count + 1);
    const baseKey =
      count === 0
        ? `${record.itemId}:${identity}`
        : `${record.itemId}:${identity}:${count}`;
    const key = record.foreignFileKeys.has(baseKey)
      ? `${record.turnId ?? "thread"}:${baseKey}`
      : baseKey;
    record.fileRows.push({ key, matchKeys, start: at });
    used.add(record.fileRows.length - 1);
    return record.fileRows.length - 1;
  });
}

function applyItem(
  record: ItemRecord,
  item: ThreadEventItem,
  completes: boolean,
  at: ItemRecordPoint,
  started: boolean,
): void {
  const current = record.item;
  if (
    current?.type === "commandExecution" &&
    current.approvalStatus === "waiting_for_approval" &&
    item.type === "commandExecution" &&
    item.approvalStatus === null &&
    item.status === "pending"
  ) {
    record.startedAt = at.createdAt;
  }
  record.item = item;
  record.firstItem ??= item;
  if (item.type === "fileChange") {
    matchFileRows(record, item, at);
  }
  if (item.type === "commandExecution" && item.description) {
    record.description = item.description;
  }
  record.finished = completes;
  if (completes) {
    record.completion =
      item.type === "backgroundTask" ? (record.completion ?? at) : at;
  }
  if (started) {
    record.hasStartedEvent = true;
  }
  if (record.firstPresentation === undefined && "presentation" in item) {
    record.firstPresentation = item.presentation;
  }
  if (
    completes &&
    record.textKind === "assistant" &&
    (item.type === "agentMessage" || item.type === "plan") &&
    item.text.length > 0
  ) {
    record.textStart ??= at;
    record.textEnd = at;
  }
}

function applyRole(
  store: ItemRecordStore,
  record: ItemRecord,
  role: ItemEventRole,
  entry: ThreadEventWithMeta,
  context: ApplyItemEventContext,
): void {
  const at = { seq: entry.meta.seq, createdAt: entry.meta.createdAt };
  if (record.dropped || (record.textKind !== null && record.finished)) {
    return;
  }
  if (record.stop !== null) {
    if (
      record.textKind === "reasoning" &&
      role.kind === "item" &&
      role.completes &&
      record.completion === null
    ) {
      record.item = role.item;
      record.completion = at;
      record.version += 1;
    }
    return;
  }
  if (
    record.textKind === "assistant" &&
    context.turnClosed &&
    role.kind === "text"
  ) {
    return;
  }
  record.end = at;
  record.version += 1;
  switch (role.kind) {
    case "item":
      applyItem(
        record,
        role.item,
        role.completes,
        at,
        entry.event.type === "item/started",
      );
      break;
    case "approval": {
      const current = record.item;
      if (current?.type === "commandExecution") {
        if (current.approvalStatus === "waiting_for_approval") {
          record.startedAt = at.createdAt;
        }
        record.item = { ...current, approvalStatus: null };
      } else {
        record.item = role.item;
        record.firstItem ??= role.item;
      }
      break;
    }
    case "text":
      if (role.delta.length > 0) {
        record.text += role.delta;
        if (entry.event.type === "item/reasoning/summaryTextDelta") {
          record.reasoningSummary += role.delta;
        } else if (entry.event.type === "item/reasoning/textDelta") {
          record.reasoningContent += role.delta;
        }
        record.textStart ??= at;
        record.textEnd = at;
      }
      break;
    case "output":
      record.outputKind ??= role.outputKind;
      if (record.finished) {
        record.lateOutput += role.delta;
      } else {
        record.output = role.reset ? role.delta : record.output + role.delta;
        record.flushedOutputLength = role.reset
          ? 0
          : record.flushedOutputLength;
        store.openOutput.add(record);
      }
      break;
    case "progress":
      record.outputKind ??= "tool";
      record.progress = role.message;
      break;
    case "compaction":
    case "ignored":
      break;
  }
}

export function applyItemEvent(
  store: ItemRecordStore,
  entry: ThreadEventWithMeta,
  role: Exclude<ItemEventRole, { kind: "compaction" | "ignored" }>,
  context: ApplyItemEventContext,
): ItemRecord | null {
  if (store.finalActivityIds.has(role.itemId)) {
    return null;
  }
  let record = store.currentByItemId.get(role.itemId);
  if (
    record === undefined ||
    startsNewRecord(record, role, getThreadEventScopeTurnId(entry.event.scope))
  ) {
    const item =
      role.kind === "item" || role.kind === "approval" ? role.item : null;
    const textKind = role.kind === "text" ? role.textKind : itemTextKind(item);
    const previous = record;
    record = createRecord(store, entry, role.itemId, textKind, item, context);
    if (previous?.item?.type === "fileChange") {
      record.foreignFileKeys = new Set([
        ...previous.foreignFileKeys,
        ...previous.fileRows.map((row) => row.key),
        `${previous.itemId}:0`,
      ]);
    }
  }
  applyRole(store, record, role, entry, context);
  if (record.finished) {
    store.openText.delete(record);
    store.openOutput.delete(record);
    if (record.item !== null && ACTIVITY_ITEM_TYPES.has(record.item.type)) {
      store.finalActivityIds.add(record.itemId);
    }
  }
  return record;
}

export function freezeTextAndFlushOutputAtStop(
  store: ItemRecordStore,
  turnId: string | null,
  stop: ItemRecordStop,
): void {
  for (const record of store.openOutput) {
    record.flushedOutputLength = record.output.length;
    record.version += 1;
  }
  store.openOutput.clear();
  for (const record of store.openText) {
    if (turnId !== null && record.turnId !== turnId) {
      continue;
    }
    if (record.textKind === "assistant" && record.textStart === null) {
      continue;
    }
    store.openText.delete(record);
    record.version += 1;
    if (record.textKind === "reasoning" && record.text.trim().length === 0) {
      record.dropped = true;
      continue;
    }
    record.stop = stop;
  }
}

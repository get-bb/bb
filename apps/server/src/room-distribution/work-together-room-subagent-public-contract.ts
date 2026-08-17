import { threadStatusValues, type ThreadStatus } from "@bb/domain";

import type { WorkTogetherRoomCommandAuthorityV1 } from "./work-together-room-command-authority.js";
import { RoomDistributionUnavailableError } from "./room-distribution-port.js";
import { projectWorkTogetherRoomVisibleScalar } from "./work-together-room-visible-scalar.js";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_ROOM_SUBAGENTS = 64;
const MAX_SUBAGENT_DEPTH = 4;
const MAX_SERIALIZED_BYTES = 131_072;
const MAX_LABEL_BYTES = 160;
const MAX_SUMMARY_BYTES = 512;
const UNTITLED_LABEL = "Untitled subagent";
const THREAD_STATUSES = new Set<string>(threadStatusValues);
const LIVE_ATTENTION_LIFECYCLES = new Set<RoomSubagentLifecycleV1>([
  "starting",
  "running",
  "stopping",
]);

export type RoomSubagentCapabilityV1 =
  | "message.send"
  | "message.steer"
  | "agent.interrupt"
  | "interaction.answer"
  | "interaction.approve";

export type RoomSubagentLifecycleV1 =
  | "created"
  | "starting"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "interrupted"
  | "archived"
  | "unavailable";

export type RoomSubagentAttentionKindV1 = "none" | "question" | "approval";

export type RoomSubagentParentV1 = Readonly<
  { kind: "primary"; id: string } | { kind: "subagent"; id: string }
>;

export type RoomSubagentAttentionV1 = Readonly<{
  kind: RoomSubagentAttentionKindV1;
}>;

export type RoomSubagentV1 = Readonly<{
  schemaVersion: 1;
  id: string;
  parent: RoomSubagentParentV1;
  label: string;
  summary: string | null;
  lifecycle: RoomSubagentLifecycleV1;
  attention: RoomSubagentAttentionV1;
  capabilities: readonly RoomSubagentCapabilityV1[];
}>;

export type RoomSubagentPendingInteractionKindV1 = "question" | "approval";

export type WorkTogetherRoomSubagentPublicParentInputV1 = Readonly<
  { kind: "primary" } | { kind: "subagent"; id: string }
>;

export type WorkTogetherRoomSubagentPublicThreadFactsV1 = Readonly<{
  archivedAt: number | null;
  attention: RoomSubagentAttentionKindV1;
  latestPublicAssistantExcerpt: string | null;
  latestRootTurnOutcome: "completed" | "failed" | "interrupted" | null;
  privateThreadId: string;
  status: ThreadStatus;
  title: string | null;
  titleFallback: string | null;
}>;

export type WorkTogetherRoomSubagentPublicAttachmentInputV1 = Readonly<{
  id: string;
  parent: WorkTogetherRoomSubagentPublicParentInputV1;
  thread: WorkTogetherRoomSubagentPublicThreadFactsV1 | null;
}>;

export type ProjectWorkTogetherRoomSubagentPublicContractInputV1 = Readonly<{
  attachments: readonly WorkTogetherRoomSubagentPublicAttachmentInputV1[];
  authority: WorkTogetherRoomCommandAuthorityV1;
  bindingId: string;
  environmentId: string;
  projectId: string;
}>;

function unavailable(): never {
  throw new RoomDistributionUnavailableError("unavailable");
}

function requireCanonicalUuid(value: string): string {
  if (!CANONICAL_UUID.test(value)) unavailable();
  return value;
}

export function deriveWorkTogetherRoomSubagentAttentionV1(
  kinds: readonly RoomSubagentPendingInteractionKindV1[],
): RoomSubagentAttentionKindV1 {
  if (kinds.length === 0) return "none";
  if (kinds.length === 1) {
    const kind = kinds[0];
    if (kind === "question" || kind === "approval") return kind;
  }
  unavailable();
}

export function deriveWorkTogetherRoomSubagentCapabilitiesV1(input: {
  attention: RoomSubagentAttentionKindV1;
  authority: WorkTogetherRoomCommandAuthorityV1;
  lifecycle: RoomSubagentLifecycleV1;
}): readonly RoomSubagentCapabilityV1[] {
  const capabilities: RoomSubagentCapabilityV1[] = [];
  const canInterrupt =
    input.authority.role === "owner" || input.authority.isTaskAssignee;
  switch (input.lifecycle) {
    case "created":
    case "completed":
    case "interrupted":
      capabilities.push("message.send");
      break;
    case "starting":
      if (canInterrupt) capabilities.push("agent.interrupt");
      break;
    case "running":
      capabilities.push("message.send", "message.steer");
      if (canInterrupt) capabilities.push("agent.interrupt");
      break;
    case "stopping":
    case "failed":
    case "archived":
    case "unavailable":
      break;
  }
  if (LIVE_ATTENTION_LIFECYCLES.has(input.lifecycle)) {
    if (
      input.attention === "question" &&
      (input.authority.role === "owner" || input.authority.role === "member")
    ) {
      capabilities.push("interaction.answer");
    }
    if (input.attention === "approval" && input.authority.role === "owner") {
      capabilities.push("interaction.approve");
    }
  }
  return Object.freeze(capabilities);
}

export function deriveWorkTogetherRoomSubagentLifecycleV1(
  thread: WorkTogetherRoomSubagentPublicThreadFactsV1,
): RoomSubagentLifecycleV1 {
  if (!THREAD_STATUSES.has(thread.status)) unavailable();
  if (
    thread.latestRootTurnOutcome !== null &&
    thread.latestRootTurnOutcome !== "completed" &&
    thread.latestRootTurnOutcome !== "failed" &&
    thread.latestRootTurnOutcome !== "interrupted"
  ) {
    unavailable();
  }
  if (thread.archivedAt !== null) return "archived";
  switch (thread.status) {
    case "starting":
      return "starting";
    case "active":
      return "running";
    case "stopping":
      return "stopping";
    case "error":
      return "failed";
    case "idle":
      if (thread.latestRootTurnOutcome === "failed") return "failed";
      if (thread.latestRootTurnOutcome === "completed") return "completed";
      if (thread.latestRootTurnOutcome === "interrupted") return "interrupted";
      return "created";
  }
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function projectLabel(
  thread: WorkTogetherRoomSubagentPublicThreadFactsV1,
  publicStreamId: string,
  identity: Omit<
    Parameters<typeof projectWorkTogetherRoomVisibleScalar>[1],
    "publicStreamId" | "privateThreadId"
  >,
): string {
  const scalarIdentity = {
    ...identity,
    privateThreadId: thread.privateThreadId,
    publicStreamId,
  };
  for (const candidate of [thread.title, thread.titleFallback]) {
    if (candidate === null) continue;
    const projected = projectWorkTogetherRoomVisibleScalar(
      candidate,
      scalarIdentity,
      MAX_LABEL_BYTES,
      true,
    );
    if (projected !== null) return projected;
  }
  return UNTITLED_LABEL;
}

function projectSummary(
  thread: WorkTogetherRoomSubagentPublicThreadFactsV1,
  publicStreamId: string,
  identity: Omit<
    Parameters<typeof projectWorkTogetherRoomVisibleScalar>[1],
    "publicStreamId" | "privateThreadId"
  >,
): string | null {
  if (thread.latestPublicAssistantExcerpt === null) return null;
  const collapsed = collapseWhitespace(thread.latestPublicAssistantExcerpt);
  return projectWorkTogetherRoomVisibleScalar(
    collapsed,
    {
      ...identity,
      privateThreadId: thread.privateThreadId,
      publicStreamId,
    },
    MAX_SUMMARY_BYTES,
    true,
  );
}

function projectParent(
  parent: WorkTogetherRoomSubagentPublicParentInputV1,
  bindingId: string,
): RoomSubagentParentV1 {
  if (parent.kind === "primary") {
    return Object.freeze({ kind: "primary", id: bindingId });
  }
  if (parent.kind !== "subagent") unavailable();
  return Object.freeze({
    kind: "subagent",
    id: requireCanonicalUuid(parent.id),
  });
}

function projectUnavailable(
  attachment: WorkTogetherRoomSubagentPublicAttachmentInputV1,
  bindingId: string,
): RoomSubagentV1 {
  return Object.freeze({
    schemaVersion: 1,
    id: requireCanonicalUuid(attachment.id),
    parent: projectParent(attachment.parent, bindingId),
    label: UNTITLED_LABEL,
    summary: null,
    lifecycle: "unavailable",
    attention: Object.freeze({ kind: "none" }),
    capabilities: Object.freeze([]),
  });
}

function projectResolved(
  attachment: WorkTogetherRoomSubagentPublicAttachmentInputV1,
  thread: WorkTogetherRoomSubagentPublicThreadFactsV1,
  input: ProjectWorkTogetherRoomSubagentPublicContractInputV1,
): RoomSubagentV1 {
  if (thread.privateThreadId.length === 0) unavailable();
  const id = requireCanonicalUuid(attachment.id);
  const lifecycle = deriveWorkTogetherRoomSubagentLifecycleV1(thread);
  if (
    thread.attention !== "none" &&
    thread.attention !== "question" &&
    thread.attention !== "approval"
  ) {
    unavailable();
  }
  if (
    (thread.attention === "question" || thread.attention === "approval") &&
    !LIVE_ATTENTION_LIFECYCLES.has(lifecycle)
  ) {
    unavailable();
  }
  const identity = {
    bindingId: input.bindingId,
    environmentId: input.environmentId,
    projectId: input.projectId,
  };
  const capabilities = deriveWorkTogetherRoomSubagentCapabilitiesV1({
    attention: thread.attention,
    authority: input.authority,
    lifecycle,
  });
  return Object.freeze({
    schemaVersion: 1,
    id,
    parent: projectParent(attachment.parent, input.bindingId),
    label: projectLabel(thread, id, identity),
    summary: projectSummary(thread, id, identity),
    lifecycle,
    attention: Object.freeze({ kind: thread.attention }),
    capabilities,
  });
}

function validateGraph(
  attachments: readonly WorkTogetherRoomSubagentPublicAttachmentInputV1[],
): void {
  if (attachments.length > MAX_ROOM_SUBAGENTS) unavailable();
  const seen = new Set<string>();
  const depthById = new Map<string, number>();
  for (const attachment of attachments) {
    const id = requireCanonicalUuid(attachment.id);
    if (seen.has(id)) unavailable();
    seen.add(id);
    if (attachment.parent.kind === "primary") {
      depthById.set(id, 1);
      continue;
    }
    if (attachment.parent.kind !== "subagent") unavailable();
    const parentId = requireCanonicalUuid(attachment.parent.id);
    if (parentId === id || !seen.has(parentId)) unavailable();
    const parentDepth = depthById.get(parentId);
    if (parentDepth === undefined) unavailable();
    const depth = parentDepth + 1;
    if (depth > MAX_SUBAGENT_DEPTH) unavailable();
    depthById.set(id, depth);
  }
}

function assertExactSubagent(subagent: RoomSubagentV1): void {
  const subagentKeys = Object.keys(subagent);
  if (
    subagentKeys.length !== 8 ||
    subagentKeys[0] !== "schemaVersion" ||
    subagentKeys[1] !== "id" ||
    subagentKeys[2] !== "parent" ||
    subagentKeys[3] !== "label" ||
    subagentKeys[4] !== "summary" ||
    subagentKeys[5] !== "lifecycle" ||
    subagentKeys[6] !== "attention" ||
    subagentKeys[7] !== "capabilities" ||
    subagent.schemaVersion !== 1
  ) {
    unavailable();
  }
  const parentKeys = Object.keys(subagent.parent);
  if (
    parentKeys.length !== 2 ||
    parentKeys[0] !== "kind" ||
    parentKeys[1] !== "id"
  ) {
    unavailable();
  }
  const attentionKeys = Object.keys(subagent.attention);
  if (attentionKeys.length !== 1 || attentionKeys[0] !== "kind") {
    unavailable();
  }
}

/**
 * Deep Room Subagent public projector. Callers supply authority-ordered
 * attachments plus lifecycle/attention facts and receive exact RoomSubagentV1.
 */
export function projectWorkTogetherRoomSubagentPublicContract(
  input: ProjectWorkTogetherRoomSubagentPublicContractInputV1,
): readonly RoomSubagentV1[] {
  requireCanonicalUuid(input.bindingId);
  if (
    input.environmentId.length === 0 ||
    input.projectId.length === 0 ||
    (input.authority.role !== "owner" && input.authority.role !== "member") ||
    typeof input.authority.isTaskAssignee !== "boolean"
  ) {
    unavailable();
  }
  validateGraph(input.attachments);
  const subagents = input.attachments.map((attachment) =>
    attachment.thread === null
      ? projectUnavailable(attachment, input.bindingId)
      : projectResolved(attachment, attachment.thread, input),
  );
  for (const subagent of subagents) assertExactSubagent(subagent);
  let serialized: string;
  try {
    serialized = JSON.stringify(subagents);
  } catch {
    unavailable();
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_SERIALIZED_BYTES) {
    unavailable();
  }
  return Object.freeze(subagents);
}

import type { EntityKind } from "../../../lib/sync/registry.js";
import type { BaseRow } from "../store/base-snapshot.js";
import { createSerializer } from "../serialize/serializer.js";
import type { PlanItem } from "../plan/index.js";
import type {
  ApplyResult,
  EntityPusher,
  PushContext,
  PushErrorDetail,
  ReadBackResult,
} from "./types.js";

const HASH_OPTIONS = {
  idToSlug: (_remoteId: string): null => null,
  onWarning: (): void => undefined,
};

export interface ConfirmedApply {
  remoteId: string | null;
  payload: Record<string, unknown> | null;
  newBaseContentHash: string | null;
}

export type VerificationOutcome =
  | { ok: true; confirmed: ConfirmedApply }
  | { ok: false; error: PushErrorDetail };

export type ReconciliationOutcome =
  | { state: "intended"; confirmed: ConfirmedApply }
  | { state: "base" }
  | { state: "ambiguous" };

function semanticHash(kind: EntityKind, payload: Record<string, unknown>): string {
  return createSerializer(kind).contentHash(payload, HASH_OPTIONS);
}

function equalPayload(
  kind: EntityKind,
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return semanticHash(kind, left) === semanticHash(kind, right);
}

function copyPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(payload);
}

export function intendedPayload(
  item: PlanItem,
  base: BaseRow | null,
): Record<string, unknown> | null {
  if (item.operation === "delete") return null;
  if (item.operation === "conflict" || item.operation === "orphan") {
    throw new Error(`Non-applicable ${item.operation} item has no intended payload`);
  }
  const next = base === null ? {} : copyPayload(base.payload);
  for (const field of item.fields) {
    if (field.ours.present) {
      next[field.field] = structuredClone(field.ours.value);
    } else {
      delete next[field.field];
    }
  }
  return next;
}

function validExistingReadBack(value: ReadBackResult): value is ReadBackResult & {
  exists: true;
  payload: Record<string, unknown>;
} {
  return value.exists && value.payload !== null;
}

function confirmedFromReadBack(
  item: PlanItem,
  expected: Record<string, unknown> | null,
  readBack: ReadBackResult,
): ConfirmedApply | null {
  if (expected === null) {
    return readBack.exists
      ? null
      : { remoteId: null, payload: null, newBaseContentHash: null };
  }
  if (!validExistingReadBack(readBack) || !equalPayload(item.kind, expected, readBack.payload)) {
    return null;
  }
  return {
    remoteId: readBack.remoteId,
    payload: readBack.payload,
    newBaseContentHash: semanticHash(item.kind, readBack.payload),
  };
}

function confirmedFromResponse(
  item: PlanItem,
  expected: Record<string, unknown> | null,
  apply: ApplyResult,
): ConfirmedApply | null {
  if (expected === null) return null;
  if (apply.serverPayload === null || !equalPayload(item.kind, expected, apply.serverPayload)) {
    return null;
  }
  return {
    remoteId: apply.remoteId,
    payload: apply.serverPayload,
    newBaseContentHash: semanticHash(item.kind, apply.serverPayload),
  };
}

export async function verifyApply(
  pusher: EntityPusher,
  item: PlanItem,
  expected: Record<string, unknown> | null,
  apply: ApplyResult,
  context: PushContext,
): Promise<VerificationOutcome> {
  const requiresReadBack = apply.verification === "required" || item.operation === "delete";
  const confirmed = requiresReadBack
    ? confirmedFromReadBack(item, expected, await pusher.readBack(item, context))
    : confirmedFromResponse(item, expected, apply);
  if (confirmed !== null) return { ok: true, confirmed };
  return {
    ok: false,
    error: {
      code: "READ_BACK_MISMATCH",
      message: requiresReadBack
        ? `Read-back did not match the intended semantic payload for ${item.kind}/${item.key}`
        : `Authoritative response did not match the intended semantic payload for ${item.kind}/${item.key}`,
      retryable: false,
    },
  };
}

function matchesBase(item: PlanItem, base: BaseRow | null, readBack: ReadBackResult): boolean {
  if (base === null) return !readBack.exists;
  return validExistingReadBack(readBack) && equalPayload(item.kind, base.payload, readBack.payload);
}

export async function reconcileReadBack(
  pusher: EntityPusher,
  item: PlanItem,
  base: BaseRow | null,
  expected: Record<string, unknown> | null,
  context: PushContext,
): Promise<ReconciliationOutcome> {
  const readBack = await pusher.readBack(item, context);
  const intended = confirmedFromReadBack(item, expected, readBack);
  if (intended !== null) return { state: "intended", confirmed: intended };
  if (matchesBase(item, base, readBack)) return { state: "base" };
  return { state: "ambiguous" };
}

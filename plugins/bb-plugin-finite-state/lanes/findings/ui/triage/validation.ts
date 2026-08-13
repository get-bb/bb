import type {
  VexJustification,
  VexResponse,
  VexStatus,
} from "../../../../lib/remote/types.js";

export const VEX_STATUS_VALUES = [
  "EXPLOITABLE",
  "IN_TRIAGE",
  "NOT_AFFECTED",
  "FALSE_POSITIVE",
  "RESOLVED",
  "RESOLVED_WITH_PEDIGREE",
] as const satisfies readonly VexStatus[];

export const VEX_RESPONSE_VALUES = [
  "CAN_NOT_FIX",
  "WILL_NOT_FIX",
  "UPDATE",
  "ROLLBACK",
  "WORKAROUND_AVAILABLE",
] as const satisfies readonly VexResponse[];

export const VEX_JUSTIFICATION_VALUES = [
  "CODE_NOT_PRESENT",
  "CODE_NOT_REACHABLE",
  "REQUIRES_CONFIGURATION",
  "REQUIRES_DEPENDENCY",
  "REQUIRES_ENVIRONMENT",
  "PROTECTED_BY_COMPILER",
  "PROTECTED_AT_RUNTIME",
  "PROTECTED_AT_PERIMETER",
  "PROTECTED_BY_MITIGATING_CONTROL",
] as const satisfies readonly VexJustification[];

export const VEX_SHORTCUTS = {
  n: "NOT_AFFECTED",
  e: "EXPLOITABLE",
  t: "IN_TRIAGE",
  f: "FALSE_POSITIVE",
  r: "RESOLVED",
  R: "RESOLVED_WITH_PEDIGREE",
} as const satisfies Readonly<Record<string, VexStatus>>;

export interface TriageDraft {
  stableKey: string;
  status: VexStatus;
  justification: VexJustification | null;
  response: VexResponse | null;
  reason: string;
  evidence: string;
  pin: "exact_version" | "any_version";
}

const statuses = new Set<string>(VEX_STATUS_VALUES);
const responses = new Set<string>(VEX_RESPONSE_VALUES);
const justifications = new Set<string>(VEX_JUSTIFICATION_VALUES);
const MIN_REASON_LENGTH = 12;

export function validateTriageDraft(
  draft: TriageDraft,
): { ok: true } | { ok: false; field: string; message: string } {
  if (!draft.stableKey.trim()) return { ok: false, field: "stableKey", message: "Choose an exact finding row before deciding." };
  if (!statuses.has(draft.status)) return { ok: false, field: "status", message: "Choose one of the six VEX statuses." };
  if (draft.justification !== null && !justifications.has(draft.justification)) {
    return { ok: false, field: "justification", message: "Choose a justification from the frozen VEX vocabulary." };
  }
  if (draft.status === "NOT_AFFECTED" && draft.justification === null) {
    return { ok: false, field: "justification", message: "NOT_AFFECTED requires a justification." };
  }
  if (draft.status !== "NOT_AFFECTED" && draft.justification !== null) {
    return { ok: false, field: "justification", message: "Justification is only valid for NOT_AFFECTED." };
  }
  if (draft.response !== null && !responses.has(draft.response)) {
    return { ok: false, field: "response", message: "Choose a response from the frozen VEX vocabulary." };
  }
  if (draft.reason.trim().length < MIN_REASON_LENGTH) {
    return { ok: false, field: "reason", message: `Reason must contain at least ${MIN_REASON_LENGTH} meaningful characters.` };
  }
  if (!draft.evidence.trim()) {
    return { ok: false, field: "evidence", message: "Record the evidence reviewed for this decision." };
  }
  if (draft.pin !== "exact_version" && draft.pin !== "any_version") {
    return { ok: false, field: "pin", message: "Choose an exact-version or any-version pin." };
  }
  if (draft.justification === "CODE_NOT_REACHABLE" && draft.pin !== "exact_version") {
    return { ok: false, field: "pin", message: "CODE_NOT_REACHABLE is build-specific and must remain pinned to the exact version." };
  }
  return { ok: true };
}

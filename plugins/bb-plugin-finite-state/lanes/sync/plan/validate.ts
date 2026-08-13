import {
  VEX_JUSTIFICATIONS,
  VEX_RESPONSES,
  VEX_STATUSES,
} from "../../../lib/remote/types.js";
import type { EntityKind } from "../../../lib/sync/registry.js";
import { canonicalJson } from "../serialize/canonical.js";
import type { PlanItem, ValidationError } from "./index.js";
import { planItemId, type ReferenceGraph } from "./order.js";

export interface SourceLocation {
  file: string;
  line: number | null;
}

export interface ValidateCtx {
  scope: { projectId: string; projectVersionId: string | null };
  items: ReadonlyMap<string, PlanItem>;
  payloads: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  references: ReferenceGraph;
  sources: ReadonlyMap<string, SourceLocation>;
}

export type Validator = (item: PlanItem, ctx: ValidateCtx) => PlanItem;

const validators = new Map<EntityKind, Set<Validator>>();
const UNIVERSAL_DERIVED_FIELDS = new Set([
  "risk_value_numeric",
  "riskValueNumeric",
  "severity_level_source",
  "severityLevelSource",
  "exploitability",
  "exploitability_output",
  "exploitability_outputs",
  "exploitabilityOutput",
  "exploitabilityOutputs",
  "exploitability_score",
  "exploitabilityScore",
]);
const DERIVED_FIELDS_BY_KIND: Readonly<Partial<Record<EntityKind, ReadonlySet<string>>>> = {
  requirement: new Set([
    "verification_status",
    "verificationStatus",
  ]),
};
const VEX_STATUS_SET: ReadonlySet<string> = new Set(VEX_STATUSES);
const VEX_RESPONSE_SET: ReadonlySet<string> = new Set(VEX_RESPONSES);
const VEX_JUSTIFICATION_SET: ReadonlySet<string> = new Set(VEX_JUSTIFICATIONS);

/** Registers an additive surface-owned validator for one frozen entity kind. */
export function registerValidator(kind: EntityKind, validator: Validator): void {
  const current = validators.get(kind) ?? new Set<Validator>();
  current.add(validator);
  validators.set(kind, current);
}

function withError(item: PlanItem, error: ValidationError): PlanItem {
  return item.error === null ? { ...item, error } : item;
}

function sourceError(
  item: PlanItem,
  ctx: ValidateCtx,
  code: string,
  message: string,
): PlanItem {
  const source = ctx.sources.get(planItemId(item));
  return withError(item, {
    code,
    message,
    artifactId: source?.file ?? null,
    line: source?.line ?? null,
  });
}

function locallyChangedFields(item: PlanItem): string[] {
  if (item.operation === "delete" || item.operation === "noop") return [];
  return item.fields
    .filter((field) => (
      field.base.present !== field.ours.present
      || canonicalJson(field.base.value) !== canonicalJson(field.ours.value)
    ))
    .map((field) => field.field);
}

function derivedFieldGuard(item: PlanItem, ctx: ValidateCtx): PlanItem {
  const kindFields = DERIVED_FIELDS_BY_KIND[item.kind];
  const field = locallyChangedFields(item).find((candidate) => (
    UNIVERSAL_DERIVED_FIELDS.has(candidate) || kindFields?.has(candidate) === true
  ));
  if (field === undefined) return item;
  return sourceError(
    item,
    ctx,
    "DERIVED_FIELD",
    `${item.kind}.${field} is server-derived and cannot be authored`,
  );
}

function isIncompleteDecision(payload: Readonly<Record<string, unknown>>): boolean {
  return payload["needs_completion"] === true
    || payload["needsCompletion"] === true
    || payload["state"] === "needs_completion"
    || payload["drift_state"] === "needs_completion"
    || payload["driftState"] === "needs_completion";
}

function vexVocabulary(item: PlanItem, ctx: ValidateCtx): PlanItem {
  if (item.kind !== "vexDecision" || item.operation === "delete" || item.operation === "noop") return item;
  const payload = ctx.payloads.get(planItemId(item));
  if (payload === undefined) return item;
  if (isIncompleteDecision(payload)) {
    return sourceError(
      item,
      ctx,
      "NEEDS_COMPLETION",
      "VEX decision is incomplete and must be completed before apply",
    );
  }

  const status = payload["status"];
  if (status !== null && status !== undefined && (typeof status !== "string" || !VEX_STATUS_SET.has(status))) {
    return sourceError(item, ctx, "VEX_STATUS_INVALID", "VEX status is not in the frozen vocabulary");
  }
  const response = payload["response"];
  if (response !== null && response !== undefined && (typeof response !== "string" || !VEX_RESPONSE_SET.has(response))) {
    return sourceError(item, ctx, "VEX_RESPONSE_INVALID", "VEX response is not in the frozen vocabulary");
  }
  const justification = payload["justification"];
  if (
    justification !== null
    && justification !== undefined
    && (typeof justification !== "string" || !VEX_JUSTIFICATION_SET.has(justification))
  ) {
    return sourceError(
      item,
      ctx,
      "VEX_JUSTIFICATION_INVALID",
      "VEX justification is not in the frozen vocabulary",
    );
  }
  if (status === "NOT_AFFECTED" && (justification === null || justification === undefined)) {
    return sourceError(
      item,
      ctx,
      "VEX_JUSTIFICATION_REQUIRED",
      "NOT_AFFECTED requires a frozen VEX justification",
    );
  }
  return item;
}

function referentialIntegrity(item: PlanItem, ctx: ValidateCtx): PlanItem {
  if (item.operation !== "delete") return item;
  const targetId = planItemId(item);
  const referrers = [...ctx.references.entries()]
    .filter(([, dependencies]) => dependencies.includes(targetId))
    .map(([referrerId]) => ctx.items.get(referrerId))
    .filter((referrer): referrer is PlanItem => (
      referrer !== undefined && referrer.operation !== "delete"
    ))
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((referrer) => ({
      projectId: referrer.projectId,
      projectVersionId: referrer.projectVersionId,
      kind: referrer.kind,
      key: referrer.key,
      label: referrer.label,
    }));
  if (referrers.length === 0) return item;
  return withError({ ...item, referrers }, {
    code: "REFERENTIAL_INTEGRITY",
    message: `referenced by ${referrers.map((referrer) => referrer.label).join(", ")}`,
    artifactId: null,
    line: null,
  });
}

/** Runs built-in validation families followed by every registered surface validator. */
export function validatePlanItem(item: PlanItem, ctx: ValidateCtx): PlanItem {
  let current = referentialIntegrity(item, ctx);
  current = derivedFieldGuard(current, ctx);
  current = vexVocabulary(current, ctx);
  for (const validator of validators.get(item.kind) ?? []) {
    const firstError = current.error;
    const next = validator(current, ctx);
    current = firstError === null ? next : { ...next, error: firstError };
  }
  return current;
}

export function validatePlanItems(items: readonly PlanItem[], ctx: ValidateCtx): PlanItem[] {
  return items.map((item) => validatePlanItem(item, ctx));
}

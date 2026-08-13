import type { JsonValue } from "../../../shared/contract.js";
import { canonicalJson } from "../serialize/canonical.js";
import type { FieldDiff, FieldValue, PlanOp } from "./index.js";

export interface SideDiff {
  field: string;
  base: FieldValue;
  value: FieldValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => jsonValue(entry));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter((entry) => entry[1] !== undefined)
        .map(([key, entry]) => [key, jsonValue(entry)]),
    );
  }
  throw new TypeError("Semantic plan values must be finite JSON values");
}

function fieldValue(
  payload: Readonly<Record<string, unknown>> | undefined,
  field: string,
): FieldValue {
  if (payload === undefined || !Object.hasOwn(payload, field)) {
    return { present: false, value: null };
  }
  return { present: true, value: jsonValue(payload[field]) };
}

export function sameFieldValue(left: FieldValue, right: FieldValue): boolean {
  return left.present === right.present
    && canonicalJson(left.value) === canonicalJson(right.value);
}

export function sameEntity(
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>> | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(left) === canonicalJson(right);
}

/** Computes one side of a field-level semantic diff. */
export function diff(
  base: Readonly<Record<string, unknown>> | undefined,
  value: Readonly<Record<string, unknown>> | undefined,
): SideDiff[] {
  const fields = new Set([...Object.keys(base ?? {}), ...Object.keys(value ?? {})]);
  return [...fields]
    .sort((left, right) => left.localeCompare(right))
    .map((field) => ({
      field,
      base: fieldValue(base, field),
      value: fieldValue(value, field),
    }))
    .filter((entry) => !sameFieldValue(entry.base, entry.value));
}

/** Builds the immutable three-way field values carried by a persisted plan. */
export function threeWayDiff(
  base: Readonly<Record<string, unknown>> | undefined,
  working: Readonly<Record<string, unknown>> | undefined,
  remote: Readonly<Record<string, unknown>> | undefined,
): FieldDiff[] {
  const fields = new Set([
    ...Object.keys(base ?? {}),
    ...Object.keys(working ?? {}),
    ...Object.keys(remote ?? {}),
  ]);
  return [...fields]
    .sort((left, right) => left.localeCompare(right))
    .map((field) => ({
      field,
      base: fieldValue(base, field),
      ours: fieldValue(working, field),
      theirs: fieldValue(remote, field),
    }))
    .filter((entry) => (
      !sameFieldValue(entry.base, entry.ours)
      || !sameFieldValue(entry.base, entry.theirs)
    ));
}

export function conflictingFields(fields: readonly FieldDiff[]): FieldDiff[] {
  return fields.filter((field) => (
    !sameFieldValue(field.base, field.ours)
    && !sameFieldValue(field.base, field.theirs)
    && !sameFieldValue(field.ours, field.theirs)
  ));
}

/** Classifies one entity from the pristine base, authored working state, and fresh remote state. */
export function classifyThreeWay(
  base: Readonly<Record<string, unknown>> | undefined,
  working: Readonly<Record<string, unknown>> | undefined,
  remote: Readonly<Record<string, unknown>> | undefined,
  allowDelete = true,
): PlanOp {
  const oursChanged = !sameEntity(base, working);
  const theirsChanged = !sameEntity(base, remote);

  if (!oursChanged) return "noop";
  if (theirsChanged) return sameEntity(working, remote) ? "noop" : "conflict";
  if (base === undefined && working !== undefined) return "create";
  if (base !== undefined && working === undefined) return allowDelete ? "delete" : "noop";
  return "update";
}

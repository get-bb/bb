import type { FieldDiff, FieldValue, Plan, PlanItem } from "./index.js";
import { sameFieldValue } from "./diff.js";

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return count === 1 ? singular : pluralValue;
}

function conflictValue(value: FieldValue): string {
  if (!value.present) return "<absent>";
  return JSON.stringify(value.value);
}

function rowValue(value: FieldValue): string {
  if (!value.present) return "<absent>";
  if (typeof value.value === "string") return value.value.replaceAll(/\s+/gu, " ");
  return JSON.stringify(value.value);
}

function localFields(item: PlanItem): FieldDiff[] {
  return item.fields.filter((field) => !sameFieldValue(field.base, field.ours));
}

function firstDescription(item: PlanItem): string | null {
  const fields = localFields(item);
  const preferred = ["title", "description", "statement", "name", "status"];
  const selected = preferred
    .map((name) => fields.find((field) => field.field === name))
    .find((field) => field !== undefined);
  if (selected === undefined || !selected.ours.present) return null;
  const text = rowValue(selected.ours).replaceAll("\n", " ");
  return `"${text.replaceAll('"', '\\"')}"`;
}

function updateDescription(item: PlanItem): string | null {
  const fields = localFields(item);
  if (fields.length === 0) return null;
  if (item.kind === "vexDecision") {
    const status = fields.find((field) => field.field === "status")?.ours;
    const justification = fields.find((field) => field.field === "justification")?.ours;
    if (status?.present === true) {
      return `→ ${rowValue(status)}${justification?.present === true ? ` (${rowValue(justification)})` : ""}`;
    }
  }
  return fields.slice(0, 3).map((field) => (
    `${field.field}: ${rowValue(field.base)} → ${rowValue(field.ours)}`
  )).join(", ");
}

function operationRow(item: PlanItem): string {
  const marker = item.operation === "create" ? "+" : item.operation === "update" ? "~" : "-";
  const description = item.operation === "create"
    ? firstDescription(item)
    : item.operation === "update"
      ? updateDescription(item)
      : null;
  const references = item.referrers.length > 0
    ? `⚠ referenced by ${item.referrers.map((referrer) => referrer.label).join(", ")}`
    : null;
  return `  ${marker} ${item.operation}  ${item.label}${description === null ? "" : `  ${description}`}${references === null ? "" : `   ${references}`}`;
}

function attributionSuffix(item: PlanItem, field: string): string {
  const attribution = item.conflicts.find((conflict) => conflict.field === field)?.attribution;
  if (attribution === null || attribution === undefined) return "";
  const formattedAt = attribution.at?.replace(/^([^T]+)T([0-9]{2}:[0-9]{2}).*$/u, "$1 $2") ?? null;
  const parts = [attribution.actor, formattedAt]
    .filter((value): value is string => value !== null);
  return parts.length === 0 ? "" : `  (${parts.join(", ")})`;
}

function errorLine(item: PlanItem): string | null {
  if (item.error === null || item.error.code === "REFERENTIAL_INTEGRITY") return null;
  const location = item.error.artifactId === null
    ? ""
    : ` (${item.error.artifactId}${item.error.line === null ? "" : `:${item.error.line}`})`;
  return `    ⚠ ${item.error.code}: ${item.error.message}${location}`;
}

/** Renders the stable SPEC 01 section-5 CLI representation. */
export function renderPlanCli(plan: Plan): string {
  const lines = [
    `Plan: ${plan.summary.creates} to create, ${plan.summary.updates} to update, ${plan.summary.deletes} to delete, ${plan.summary.conflicts} conflicts`,
  ];
  const writeItems = plan.items.filter((item) => (
    item.operation === "create" || item.operation === "update" || item.operation === "delete"
  ));
  if (writeItems.length > 0) {
    lines.push("");
    for (const item of writeItems) {
      lines.push(operationRow(item));
      const error = errorLine(item);
      if (error !== null) lines.push(error);
    }
  }

  const conflictItems = plan.items.filter((item) => item.operation === "conflict");
  for (const item of conflictItems) {
    const conflicts = item.conflicts.length > 0 ? item.conflicts : item.fields;
    for (const conflict of conflicts) {
      lines.push(
        "",
        `  ⚠ conflict  ${item.label}.${conflict.field}`,
        `       base:   ${conflictValue(conflict.base)}`,
        `       ours:   ${conflictValue(conflict.ours)}`,
        `       theirs: ${conflictValue(conflict.theirs)}${attributionSuffix(item, conflict.field)}`,
      );
    }
  }

  if (plan.summary.orphans > 0) {
    lines.push(
      "",
      `  ${plan.summary.orphans} orphaned overlay ${plural(plan.summary.orphans, "decision")} (component no longer present) — see status`,
    );
  }
  if (plan.staleness.degraded) {
    lines.push("", `  ⚠ upstream refresh unavailable; using base as of ${plan.staleness.asOf}`);
  }
  return `${lines.join("\n")}\n`;
}

import {
  VEX_JUSTIFICATIONS,
  VEX_RESPONSES,
  VEX_STATUSES,
  type VexJustification,
  type VexResponse,
  type VexStatus,
} from "../../../lib/remote/types.js";
import { ENTITIES, parseFindingStableKey } from "../../../lib/sync/registry.js";
import { enforcePin, type Pin } from "../stable-key/index.js";
import { SerializeError } from "../../sync/serialize/yaml.js";

export const TRIAGE_OVERLAY_SCHEMA = "fs-triage/v1" as const;
export const MAX_OVERLAY_BYTES = 5 * 1024 * 1024;

export interface VexTuple {
  status: VexStatus | null;
  justification: VexJustification | null;
  response: VexResponse | null;
  reason: string | null;
}

export interface TriageDecisionV1 {
  status: VexStatus;
  justification: VexJustification | null;
  response: VexResponse | null;
  reason: string;
  pin: Pin;
  provenance: { by: string; at: string; evidence: string };
  sync: { base: VexTuple | null; pushed_at: string | null };
}

export interface TriageOverlayV1 {
  schema: typeof TRIAGE_OVERLAY_SCHEMA;
  project: string;
  component: {
    purl: string | null;
    name: string;
    group: string | null;
    version: string | null;
  };
  decisions: Record<string, TriageDecisionV1>;
}

export interface DecisionInput {
  project: string;
  component: TriageOverlayV1["component"];
  cve: string;
  stableKey: string;
  status: VexStatus;
  justification: VexJustification | null;
  response: VexResponse | null;
  reason: string;
  pin?: Pin;
  provenance: TriageDecisionV1["provenance"];
  sync?: TriageDecisionV1["sync"];
}

export interface RemoveDecisionInput {
  project: string;
  component: TriageOverlayV1["component"];
  cve: string;
  stableKey: string;
}

export type OverlayState =
  | "dirty"
  | "pushed"
  | "conflict"
  | "stale"
  | "orphaned"
  | "needs_completion";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const TOP_FIELDS = new Set(["schema", "project", "component", "decisions"]);
const COMPONENT_FIELDS = new Set(["purl", "name", "group", "version"]);
const DECISION_FIELDS = new Set(["status", "justification", "response", "reason", "pin", "provenance", "sync"]);
const PROVENANCE_FIELDS = new Set(["by", "at", "evidence"]);
const SYNC_FIELDS = new Set(["base", "pushed_at"]);
const TUPLE_FIELDS = new Set(["status", "justification", "response", "reason"]);

function record(value: unknown, field: string, file: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SerializeError(file, 1, `${field} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function exactFields(value: Record<string, unknown>, fields: ReadonlySet<string>, label: string, file: string): void {
  const unknown = Object.keys(value).find((key) => !fields.has(key));
  if (unknown !== undefined) throw new SerializeError(file, 1, `${label} contains unknown field ${unknown}`);
}

function requiredText(value: unknown, field: string, file: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SerializeError(file, 1, `${field} must be a non-empty string`);
  }
  return value.normalize("NFC");
}

function boundedText(value: unknown, field: string, maximum: number, file: string): string {
  const text = requiredText(value, field, file);
  if (text.length > maximum) throw new SerializeError(file, 1, `${field} exceeds ${maximum} characters`);
  return text;
}

function timestamp(value: unknown, field: string, file: string): string {
  const text = requiredText(value, field, file);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new SerializeError(file, 1, `${field} must be an ISO-8601 UTC timestamp`);
  }
  return text;
}

function nullableText(value: unknown, field: string, file: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new SerializeError(file, 1, `${field} must be a string or null`);
  return value.normalize("NFC");
}

function enumValue<T extends string>(value: unknown, values: readonly T[], field: string, file: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new SerializeError(file, 1, `${field} is outside the frozen VEX vocabulary`);
  }
  return value as T;
}

function nullableEnum<T extends string>(value: unknown, values: readonly T[], field: string, file: string): T | null {
  return value === null ? null : enumValue(value, values, field, file);
}

function rejectEphemeral(value: unknown, path: string, file: string): void {
  if (typeof value === "string" && UUID.test(value)) {
    throw new SerializeError(file, 1, `${path} must not contain an ephemeral UUID`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectEphemeral(item, `${path}[${index}]`, file));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:pvId|projectVersionId|findingId|findingUuid)$/iu.test(key)) {
      throw new SerializeError(file, 1, `${path}.${key} is an ephemeral identifier`);
    }
    rejectEphemeral(item, `${path}.${key}`, file);
  }
}

function parseBaseTuple(value: unknown, field: string, file: string): VexTuple {
  const raw = record(value, field, file);
  exactFields(raw, TUPLE_FIELDS, field, file);
  return {
    status: nullableEnum(raw["status"], VEX_STATUSES, `${field}.status`, file),
    justification: nullableEnum(raw["justification"], VEX_JUSTIFICATIONS, `${field}.justification`, file),
    response: nullableEnum(raw["response"], VEX_RESPONSES, `${field}.response`, file),
    reason: nullableText(raw["reason"], `${field}.reason`, file),
  };
}

function parseDecision(value: unknown, field: string, file: string): TriageDecisionV1 {
  const raw = record(value, field, file);
  exactFields(raw, DECISION_FIELDS, field, file);
  const tuple = {
    status: enumValue(raw["status"], VEX_STATUSES, `${field}.status`, file),
    justification: nullableEnum(raw["justification"], VEX_JUSTIFICATIONS, `${field}.justification`, file),
    response: nullableEnum(raw["response"], VEX_RESPONSES, `${field}.response`, file),
    reason: boundedText(raw["reason"], `${field}.reason`, 10_000, file),
  };
  if (tuple.status === "NOT_AFFECTED" && tuple.justification === null) {
    throw new SerializeError(file, 1, `${field}.justification is required for NOT_AFFECTED`);
  }
  const provenance = record(raw["provenance"], `${field}.provenance`, file);
  exactFields(provenance, PROVENANCE_FIELDS, `${field}.provenance`, file);
  const sync = record(raw["sync"], `${field}.sync`, file);
  exactFields(sync, SYNC_FIELDS, `${field}.sync`, file);
  const pinValue = raw["pin"];
  if (pinValue !== "exact_version" && pinValue !== "any_version") {
    throw new SerializeError(file, 1, `${field}.pin must be exact_version or any_version`);
  }
  let pin: Pin;
  try {
    pin = enforcePin({ pin: pinValue, justification: tuple.justification });
  } catch (error) {
    throw new SerializeError(file, 1, error instanceof Error ? error.message : String(error), { cause: error });
  }
  const pushedAt = sync["pushed_at"];
  if (pushedAt !== null && typeof pushedAt !== "string") {
    throw new SerializeError(file, 1, `${field}.sync.pushed_at must be a string or null`);
  }
  return {
    ...tuple,
    pin,
    provenance: {
      by: boundedText(provenance["by"], `${field}.provenance.by`, 1_000, file),
      at: timestamp(provenance["at"], `${field}.provenance.at`, file),
      evidence: boundedText(provenance["evidence"], `${field}.provenance.evidence`, 20_000, file),
    },
    sync: {
      base: sync["base"] === null ? null : parseBaseTuple(sync["base"], `${field}.sync.base`, file),
      pushed_at: pushedAt === null ? null : timestamp(pushedAt, `${field}.sync.pushed_at`, file),
    },
  };
}

export function stableKeyFor(project: string, component: TriageOverlayV1["component"], cve: string): string {
  void project;
  return ENTITIES.vexDecision.key({ cve, ...component });
}

export function assertStableKey(stableKey: string, project: string, component: TriageOverlayV1["component"], cve: string): void {
  parseFindingStableKey(stableKey);
  if (stableKey !== stableKeyFor(project, component, cve)) {
    throw new Error("stableKey does not match the frozen finding identity codec");
  }
}

export function parseOverlay(value: unknown, file: string): TriageOverlayV1 {
  const raw = record(value, "overlay", file);
  exactFields(raw, TOP_FIELDS, "overlay", file);
  rejectEphemeral(raw, "overlay", file);
  if (raw["schema"] !== TRIAGE_OVERLAY_SCHEMA) throw new SerializeError(file, 1, "Unsupported triage overlay schema");
  const project = requiredText(raw["project"], "project", file);
  if (project === "." || project === ".." || /[\\/]/u.test(project)) {
    throw new SerializeError(file, 1, "project must be a path-safe identity");
  }
  const componentRaw = record(raw["component"], "component", file);
  exactFields(componentRaw, COMPONENT_FIELDS, "component", file);
  const component = {
    purl: nullableText(componentRaw["purl"], "component.purl", file),
    name: requiredText(componentRaw["name"], "component.name", file),
    group: nullableText(componentRaw["group"], "component.group", file),
    version: nullableText(componentRaw["version"], "component.version", file),
  };
  const decisionsRaw = record(raw["decisions"], "decisions", file);
  if (Object.keys(decisionsRaw).length === 0) throw new SerializeError(file, 1, "decisions must contain at least one authored decision");
  const decisions: Record<string, TriageDecisionV1> = {};
  for (const cve of Object.keys(decisionsRaw).sort()) {
    requiredText(cve, "decision CVE", file);
    decisions[cve] = parseDecision(decisionsRaw[cve], `decisions.${cve}`, file);
    stableKeyFor(project, component, cve);
  }
  return { schema: TRIAGE_OVERLAY_SCHEMA, project, component, decisions };
}

export function decisionFromInput(input: DecisionInput): TriageDecisionV1 {
  const pin = enforcePin({ pin: input.pin, justification: input.justification });
  assertStableKey(input.stableKey, input.project, input.component, input.cve);
  return parseDecision({
    status: input.status,
    justification: input.justification,
    response: input.response,
    reason: input.reason,
    pin,
    provenance: input.provenance,
    sync: input.sync ?? { base: null, pushed_at: null },
  }, `decisions.${input.cve}`, "<input>");
}

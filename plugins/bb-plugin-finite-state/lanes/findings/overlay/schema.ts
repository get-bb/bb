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

export type VendorProposalMatch = "matched" | "none";
export type VendorProposalState = "proposal" | "needs_completion";

/**
 * Supplier assertions are deliberately not decisions. They may be incomplete,
 * never participate in sync planning, and require an explicit strict
 * DecisionInput write before they can become authored VEX intent.
 */
export interface VendorProposalV1 {
  cve: string;
  status: VexStatus;
  justification: VexJustification | null;
  response: VexResponse | null;
  reason: string | null;
  state: VendorProposalState;
  match: VendorProposalMatch;
  target_stable_key: string | null;
  provenance: {
    by: string;
    at: string | null;
    evidence: string;
    import_id: string;
  };
  source: {
    format: "cyclonedx" | "csaf" | "openvex";
    document_id: string;
    document_sha256: string;
    statement: string;
  };
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
  proposals?: Record<string, VendorProposalV1>;
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

export interface VendorProposalInput {
  project: string;
  component: TriageOverlayV1["component"];
  proposalId: string;
  proposal: VendorProposalV1;
}

export type OverlayState =
  | "dirty"
  | "pushed"
  | "conflict"
  | "stale"
  | "orphaned"
  | "needs_completion";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const TOP_FIELDS = new Set(["schema", "project", "component", "decisions", "proposals"]);
const COMPONENT_FIELDS = new Set(["purl", "name", "group", "version"]);
const DECISION_FIELDS = new Set(["status", "justification", "response", "reason", "pin", "provenance", "sync"]);
const PROVENANCE_FIELDS = new Set(["by", "at", "evidence"]);
const SYNC_FIELDS = new Set(["base", "pushed_at"]);
const TUPLE_FIELDS = new Set(["status", "justification", "response", "reason"]);
const PROPOSAL_FIELDS = new Set([
  "cve",
  "status",
  "justification",
  "response",
  "reason",
  "state",
  "match",
  "target_stable_key",
  "provenance",
  "source",
]);
const PROPOSAL_PROVENANCE_FIELDS = new Set(["by", "at", "evidence", "import_id"]);
const PROPOSAL_SOURCE_FIELDS = new Set(["format", "document_id", "document_sha256", "statement"]);
const SHA256 = /^[0-9a-f]{64}$/u;

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

function nullableBoundedText(value: unknown, field: string, maximum: number, file: string): string | null {
  const parsed = nullableText(value, field, file);
  if (parsed !== null && parsed.length > maximum) {
    throw new SerializeError(file, 1, `${field} exceeds ${maximum} characters`);
  }
  return parsed;
}

function nullableTimestamp(value: unknown, field: string, file: string): string | null {
  return value === null ? null : timestamp(value, field, file);
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

function parseProposal(value: unknown, field: string, file: string): VendorProposalV1 {
  const raw = record(value, field, file);
  exactFields(raw, PROPOSAL_FIELDS, field, file);
  const status = enumValue(raw["status"], VEX_STATUSES, `${field}.status`, file);
  const justification = nullableEnum(raw["justification"], VEX_JUSTIFICATIONS, `${field}.justification`, file);
  const state = raw["state"];
  if (state !== "proposal" && state !== "needs_completion") {
    throw new SerializeError(file, 1, `${field}.state must be proposal or needs_completion`);
  }
  if (status === "NOT_AFFECTED" && justification === null && state !== "needs_completion") {
    throw new SerializeError(file, 1, `${field}.state must be needs_completion when NOT_AFFECTED has no justification`);
  }
  const match = raw["match"];
  if (match !== "matched" && match !== "none") {
    throw new SerializeError(file, 1, `${field}.match must be matched or none`);
  }
  const targetStableKey = nullableText(raw["target_stable_key"], `${field}.target_stable_key`, file);
  if ((match === "none") !== (targetStableKey === null)) {
    throw new SerializeError(file, 1, `${field}.target_stable_key must be null exactly when match is none`);
  }
  if (targetStableKey !== null) {
    try {
      const parsed = parseFindingStableKey(targetStableKey);
      const cve = requiredText(raw["cve"], `${field}.cve`, file);
      if (parsed.cve !== cve) throw new Error("target CVE differs from proposal CVE");
    } catch (error) {
      throw new SerializeError(file, 1, `${field}.target_stable_key is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const provenance = record(raw["provenance"], `${field}.provenance`, file);
  exactFields(provenance, PROPOSAL_PROVENANCE_FIELDS, `${field}.provenance`, file);
  const source = record(raw["source"], `${field}.source`, file);
  exactFields(source, PROPOSAL_SOURCE_FIELDS, `${field}.source`, file);
  const format = source["format"];
  if (format !== "cyclonedx" && format !== "csaf" && format !== "openvex") {
    throw new SerializeError(file, 1, `${field}.source.format is unsupported`);
  }
  const digest = requiredText(source["document_sha256"], `${field}.source.document_sha256`, file);
  if (!SHA256.test(digest)) throw new SerializeError(file, 1, `${field}.source.document_sha256 must be SHA-256`);
  return {
    cve: boundedText(raw["cve"], `${field}.cve`, 512, file),
    status,
    justification,
    response: nullableEnum(raw["response"], VEX_RESPONSES, `${field}.response`, file),
    reason: nullableBoundedText(raw["reason"], `${field}.reason`, 10_000, file),
    state,
    match,
    target_stable_key: targetStableKey,
    provenance: {
      by: boundedText(provenance["by"], `${field}.provenance.by`, 1_000, file),
      at: nullableTimestamp(provenance["at"], `${field}.provenance.at`, file),
      evidence: boundedText(provenance["evidence"], `${field}.provenance.evidence`, 20_000, file),
      import_id: boundedText(provenance["import_id"], `${field}.provenance.import_id`, 512, file),
    },
    source: {
      format,
      document_id: boundedText(source["document_id"], `${field}.source.document_id`, 2_000, file),
      document_sha256: digest,
      statement: boundedText(source["statement"], `${field}.source.statement`, 4_096, file),
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
  const decisionsRaw = raw["decisions"] === undefined ? {} : record(raw["decisions"], "decisions", file);
  const proposalsRaw = raw["proposals"] === undefined ? {} : record(raw["proposals"], "proposals", file);
  if (Object.keys(decisionsRaw).length === 0 && Object.keys(proposalsRaw).length === 0) {
    throw new SerializeError(file, 1, "overlay must contain at least one decision or vendor proposal");
  }
  const decisions: Record<string, TriageDecisionV1> = {};
  for (const cve of Object.keys(decisionsRaw).sort()) {
    requiredText(cve, "decision CVE", file);
    decisions[cve] = parseDecision(decisionsRaw[cve], `decisions.${cve}`, file);
    stableKeyFor(project, component, cve);
  }
  const proposals: Record<string, VendorProposalV1> = {};
  for (const proposalId of Object.keys(proposalsRaw).sort()) {
    boundedText(proposalId, "proposal id", 512, file);
    proposals[proposalId] = parseProposal(proposalsRaw[proposalId], `proposals.${proposalId}`, file);
  }
  return {
    schema: TRIAGE_OVERLAY_SCHEMA,
    project,
    component,
    decisions,
    ...(Object.keys(proposals).length === 0 ? {} : { proposals }),
  };
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

export function proposalFromInput(input: VendorProposalInput): VendorProposalV1 {
  stableKeyFor(input.project, input.component, input.proposal.cve);
  return parseProposal(input.proposal, `proposals.${input.proposalId}`, "<input>");
}

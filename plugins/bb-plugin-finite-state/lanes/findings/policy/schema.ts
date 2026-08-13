import { z } from "zod";

import {
  VEX_JUSTIFICATIONS,
  VEX_RESPONSES,
  VEX_STATUSES,
  type VexJustification,
  type VexResponse,
  type VexStatus,
} from "../../../lib/remote/types.js";
import { parseYaml } from "../../sync/serialize/yaml.js";
import type { Pin } from "../stable-key/index.js";

export const TRIAGE_POLICY_SCHEMA = "fs-triage-policy/v1" as const;
export const POLICY_MAX_RULES = 1_000;
export const POLICY_MAX_SELECTOR_VALUES = 200;

type SelectorValue = string | string[];

export interface PolicyPredicate {
  reachability?: "reachable" | "unreachable" | "unknown";
  vuln_in_dataset?: boolean;
  band?: SelectorValue;
  kev?: boolean;
  vc_kev?: boolean;
  epss_gte?: number;
  severity?: SelectorValue;
  component?: SelectorValue;
  finding_type?: SelectorValue;
  cwe?: SelectorValue;
  set_status?: VexStatus;
  justification?: VexJustification | null;
}

export interface PolicyDecision {
  status: VexStatus;
  justification: VexJustification | null;
  response: VexResponse | null;
  reason: string;
  pin: Pin;
}

export interface TriagePolicyV1 {
  schema: typeof TRIAGE_POLICY_SCHEMA;
  rules: Array<{ name: string; when: PolicyPredicate; set: PolicyDecision }>;
  holdback: PolicyPredicate[];
  options: { overwrite_existing: false };
}

export class PolicyValidationError extends Error {
  readonly code = "POLICY_INVALID" as const;

  constructor(readonly file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = "PolicyValidationError";
  }
}

const nonEmptyText = z.string().trim().min(1);
const selectorValue = z.union([
  nonEmptyText,
  z.array(nonEmptyText).min(1).max(POLICY_MAX_SELECTOR_VALUES),
]);

const cachePredicateFields = {
  reachability: z.enum(["reachable", "unreachable", "unknown"]).optional(),
  vuln_in_dataset: z.boolean().optional(),
  band: selectorValue.optional(),
  kev: z.boolean().optional(),
  vc_kev: z.boolean().optional(),
  epss_gte: z.number().finite().min(0).max(1).optional(),
  severity: selectorValue.optional(),
  component: selectorValue.optional(),
  finding_type: selectorValue.optional(),
  cwe: selectorValue.optional(),
};

function hasSelector(value: object): boolean {
  return Object.keys(value).length > 0;
}

const rulePredicateSchema = z.object(cachePredicateFields)
  .strict()
  .refine(hasSelector, "Rule predicate must contain at least one selector");
const holdbackPredicateSchema = z.object({
  ...cachePredicateFields,
  set_status: z.enum(VEX_STATUSES).optional(),
  justification: z.enum(VEX_JUSTIFICATIONS).nullable().optional(),
}).strict().refine(hasSelector, "Holdback predicate must contain at least one selector");

const decisionSchema = z.object({
  status: z.enum(VEX_STATUSES),
  justification: z.enum(VEX_JUSTIFICATIONS).nullable().default(null),
  response: z.enum(VEX_RESPONSES).nullable().default(null),
  reason: z.string().trim().min(1).max(10_000),
  pin: z.enum(["exact_version", "any_version"]).default("exact_version"),
}).strict();

const policySchema = z.object({
  schema: z.literal(TRIAGE_POLICY_SCHEMA),
  rules: z.array(z.object({
    name: nonEmptyText.max(200),
    when: rulePredicateSchema,
    set: decisionSchema,
  }).strict()).min(1).max(POLICY_MAX_RULES),
  holdback: z.array(holdbackPredicateSchema).max(POLICY_MAX_RULES),
  options: z.object({ overwrite_existing: z.literal(false) }).strict(),
}).strict();

function issueMessage(result: z.ZodError): string {
  return result.issues
    .map((issue) => `${issue.path.join(".") || "policy"}: ${issue.message}`)
    .join("; ");
}

function validateTemplates(policy: TriagePolicyV1, file: string): void {
  for (const [index, rule] of policy.rules.entries()) {
    const unknown = [...rule.set.reason.matchAll(/\{([^{}]*)\}/gu)]
      .map((match) => match[1])
      .find((template) => template !== "factors" && template !== "score");
    if (unknown !== undefined) {
      throw new PolicyValidationError(file, `rules.${index}.set.reason uses unknown template {${unknown}}`);
    }
    const withoutApproved = rule.set.reason.replaceAll("{factors}", "").replaceAll("{score}", "");
    if (withoutApproved.includes("{") || withoutApproved.includes("}")) {
      throw new PolicyValidationError(file, `rules.${index}.set.reason contains an invalid template`);
    }
    if (rule.set.justification === "CODE_NOT_REACHABLE" && rule.set.pin !== "exact_version") {
      throw new PolicyValidationError(file, `rules.${index}.set.pin must be exact_version for CODE_NOT_REACHABLE`);
    }
  }
}

export function parseTriagePolicy(value: unknown, file = ".fs/triage/policy.yaml"): TriagePolicyV1 {
  const result = policySchema.safeParse(value);
  if (!result.success) throw new PolicyValidationError(file, issueMessage(result.error));
  const names = new Set<string>();
  for (const [index, rule] of result.data.rules.entries()) {
    if (names.has(rule.name)) throw new PolicyValidationError(file, `rules.${index}.name duplicates ${rule.name}`);
    names.add(rule.name);
  }
  validateTemplates(result.data, file);
  return result.data;
}

export function parseTriagePolicyText(text: string, file = ".fs/triage/policy.yaml"): TriagePolicyV1 {
  return parseTriagePolicy(parseYaml(text, file), file);
}

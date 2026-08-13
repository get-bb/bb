import { createHash, randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { DecisionInput } from "../overlay/schema.js";
import { compilePredicate, type PolicyFinding } from "./compile.js";
import { boundedPush, sample, type PolicyReport } from "./report.js";
import type { PolicyDecision, TriagePolicyV1 } from "./schema.js";

export interface PolicyScope {
  projectId: string;
  projectVersionId: string;
  project: string;
}

export interface OverlayReader {
  hasDecision(scope: PolicyScope, stableKey: string): boolean;
}

interface FindingRow {
  stable_key: string;
  finding_id: string;
  cve: string | null;
  component_name: string | null;
  component_group: string | null;
  component_version: string | null;
  component_purl: string | null;
  severity: string | null;
  band: string | null;
  epss_score: number | null;
  in_kev: number;
  in_vc_kev: number;
  reachability_score: number | null;
  reachability_factors: string | null;
  vuln_in_dataset: number | null;
  finding_type: string | null;
  cwes: string;
  vex_status: string | null;
  vex_response: string | null;
  vex_justification: string | null;
  vex_reason: string | null;
}

export interface EvaluatedCandidate {
  stableKey: string;
  rule: string;
  input: DecisionInput;
}

const evaluatedCandidates = new WeakMap<PolicyReport, readonly EvaluatedCandidate[]>();
const evaluatedPolicies = new WeakMap<PolicyReport, string>();
const evaluatedScopes = new WeakMap<PolicyReport, PolicyScope>();

export function policyFingerprint(policy: TriagePolicyV1): string {
  return JSON.stringify(policy);
}

export function policySha256(policy: TriagePolicyV1): string {
  return createHash("sha256").update(policyFingerprint(policy)).digest("hex");
}

function json(value: string | null, fallback: unknown): unknown {
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function finding(row: FindingRow): PolicyFinding {
  return {
    stableKey: row.stable_key,
    findingId: row.finding_id,
    cve: row.cve,
    componentName: row.component_name,
    componentGroup: row.component_group,
    componentVersion: row.component_version,
    componentPurl: row.component_purl,
    severity: row.severity,
    band: row.band,
    epssScore: row.epss_score,
    inKev: row.in_kev === 1,
    inVcKev: row.in_vc_kev === 1,
    reachabilityScore: row.reachability_score,
    reachabilityFactors: json(row.reachability_factors, null),
    vulnInDataset: row.vuln_in_dataset === null ? null : row.vuln_in_dataset === 1,
    findingType: row.finding_type,
    cwes: stringArray(json(row.cwes, [])),
    vexStatus: row.vex_status,
    vexResponse: row.vex_response,
    vexJustification: row.vex_justification,
    vexReason: row.vex_reason,
  };
}

function allRows(db: Database.Database, scope: PolicyScope): PolicyFinding[] {
  const rows = db.prepare(
    `SELECT f.stable_key, f.finding_id, f.cve,
            f.component_name, f.component_group, f.component_version, f.component_purl,
            f.severity, f.band, f.epss_score, f.in_kev, f.in_vc_kev,
            f.reachability_score, f.reachability_factors, f.vuln_in_dataset,
            f.finding_type, f.cwes, f.vex_status, f.vex_response,
            f.vex_justification, f.vex_reason
       FROM findings f
       JOIN sync_state s
         ON s.project_id = f.project_id
        AND s.project_version_id = f.project_version_id
        AND s.entity_kind = 'finding'
        AND s.accepted_generation_id = f.generation_id
      WHERE f.project_id = ? AND f.project_version_id = ? AND f.soft_deleted = 0
      ORDER BY f.stable_key COLLATE BINARY, f.finding_id COLLATE BINARY`,
  ).all(scope.projectId, scope.projectVersionId) as FindingRow[];
  return rows.map(finding);
}

function matchingStableKeys(
  db: Database.Database,
  scope: PolicyScope,
  compiled: ReturnType<typeof compilePredicate>,
): string[] {
  const rows = db.prepare(
    `SELECT DISTINCT f.stable_key
       FROM findings f
       JOIN sync_state s
         ON s.project_id = f.project_id
        AND s.project_version_id = f.project_version_id
        AND s.entity_kind = 'finding'
        AND s.accepted_generation_id = f.generation_id
      WHERE f.project_id = ? AND f.project_version_id = ? AND f.soft_deleted = 0
        AND (${compiled.sql})
      ORDER BY f.stable_key COLLATE BINARY`,
  ).all(scope.projectId, scope.projectVersionId, ...compiled.parameters) as Array<{ stable_key: string }>;
  return rows.map((row) => row.stable_key);
}

function grouped(findings: readonly PolicyFinding[]): Map<string, PolicyFinding[]> {
  const result = new Map<string, PolicyFinding[]>();
  for (const item of findings) {
    const group = result.get(item.stableKey) ?? [];
    group.push(item);
    result.set(item.stableKey, group);
  }
  return result;
}

function hasServerDecision(findings: readonly PolicyFinding[]): boolean {
  return findings.some((item) => item.vexStatus !== null
    || item.vexResponse !== null
    || item.vexJustification !== null
    || item.vexReason !== null);
}

function canonical(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim().length === 0 ? null : value.normalize("NFC");
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value.map(canonical).filter((item): item is string => item !== null);
    return items.length === 0 ? null : `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const fields = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== null);
    return fields.length === 0 ? null : `{${fields.map(([key, item]) => `${JSON.stringify(key)}:${item}`).join(",")}}`;
  }
  return null;
}

function escaped(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, character =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function expandReason(template: string, finding: PolicyFinding): { reason: string; missing: string | null } {
  let reason = template;
  if (reason.includes("{factors}")) {
    const factors = canonical(finding.reachabilityFactors);
    if (factors === null) return { reason, missing: "factors" };
    reason = reason.replaceAll("{factors}", escaped(factors));
  }
  if (reason.includes("{score}")) {
    if (finding.reachabilityScore === null || !Number.isFinite(finding.reachabilityScore)) {
      return { reason, missing: "score" };
    }
    reason = reason.replaceAll("{score}", String(finding.reachabilityScore));
  }
  return { reason, missing: null };
}

function matchingHoldback(
  policy: TriagePolicyV1,
  findings: readonly PolicyFinding[],
  decision: PolicyDecision,
): { rule: string; why: string } | null {
  for (const [index, predicate] of policy.holdback.entries()) {
    const compiled = compilePredicate(predicate);
    if (findings.some((item) => compiled.matches(item, decision))) {
      return {
        rule: `holdback[${index}]`,
        why: `Matched policy holdback ${JSON.stringify(predicate)}`,
      };
    }
  }
  if (findings.some((item) => item.inKev)) return { rule: "holdback:kev", why: "KEV findings always require human review" };
  if (findings.some((item) => item.inVcKev)) return { rule: "holdback:vc-kev", why: "VC-KEV findings always require human review" };
  return null;
}

export function overlayIndexReader(db: Database.Database): OverlayReader {
  const query = db.prepare(
    `SELECT 1 FROM overlay_index
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'vexDecision' AND stable_key = ?
      LIMIT 1`,
  );
  return {
    hasDecision(scope, stableKey) {
      return query.get(scope.projectId, scope.projectVersionId, stableKey) !== undefined;
    },
  };
}

export function candidatesFor(report: PolicyReport): readonly EvaluatedCandidate[] {
  return evaluatedCandidates.get(report) ?? [];
}

export function assertReusableEvaluation(report: PolicyReport, policy: TriagePolicyV1, scope: PolicyScope): void {
  const evaluatedPolicy = evaluatedPolicies.get(report);
  const evaluatedScope = evaluatedScopes.get(report);
  if (evaluatedPolicy === undefined || evaluatedScope === undefined) {
    throw new Error("Policy evaluation candidate set is unavailable; preview again before applying");
  }
  if (evaluatedPolicy !== policyFingerprint(policy)) {
    throw new Error("Policy changed after preview; preview again before applying");
  }
  if (evaluatedScope.projectId !== scope.projectId
    || evaluatedScope.projectVersionId !== scope.projectVersionId
    || evaluatedScope.project !== scope.project) {
    throw new Error("Policy evaluation scope changed after preview; preview again before applying");
  }
}

export function evaluatePolicy(
  db: Database.Database,
  overlay: OverlayReader,
  policy: TriagePolicyV1,
  scope: PolicyScope,
): PolicyReport {
  const evaluatedAt = new Date().toISOString();
  const report: PolicyReport = {
    runId: randomUUID(),
    policySha256: policySha256(policy),
    dryRun: true,
    rules: policy.rules.map((rule) => ({ name: rule.name, matched: 0, wouldWrite: 0, held: 0, samples: [] })),
    written: 0,
    held: [],
    skippedExisting: 0,
    errors: [],
  };
  const byStableKey = grouped(allRows(db, scope));
  const seen = new Set<string>();
  const candidates: EvaluatedCandidate[] = [];

  for (const [ruleIndex, rule] of policy.rules.entries()) {
    const ruleReport = report.rules[ruleIndex];
    if (ruleReport === undefined) throw new Error("Policy rule report is missing");
    const compiled = compilePredicate(rule.when);
    for (const stableKey of matchingStableKeys(db, scope, compiled)) {
      if (seen.has(stableKey)) continue;
      const matches = byStableKey.get(stableKey) ?? [];
      if (matches.length === 0 || !matches.some((item) => compiled.matches(item))) continue;
      seen.add(stableKey);
      ruleReport.matched += 1;
      sample(ruleReport, stableKey);

      if (overlay.hasDecision(scope, stableKey) || hasServerDecision(matches)) {
        report.skippedExisting += 1;
        continue;
      }

      const representative = matches[0];
      if (representative === undefined) continue;
      if (representative.cve === null || representative.componentName === null) {
        ruleReport.held += 1;
        boundedPush(report.held, { stableKey, rule: rule.name, why: "Finding lacks stable component/CVE identity" });
        continue;
      }
      if (rule.set.status === "NOT_AFFECTED" && rule.set.justification === null) {
        ruleReport.held += 1;
        boundedPush(report.held, { stableKey, rule: rule.name, why: "NOT_AFFECTED requires a justification" });
        continue;
      }
      const pin = rule.set.justification === "CODE_NOT_REACHABLE" ? "exact_version" : rule.set.pin;
      if (pin === "exact_version" && representative.componentVersion === null) {
        ruleReport.held += 1;
        boundedPush(report.held, {
          stableKey,
          rule: rule.name,
          why: "Exact-version policy decision requires component version evidence",
        });
        continue;
      }
      const holdback = matchingHoldback(policy, matches, rule.set);
      if (holdback !== null) {
        ruleReport.held += 1;
        boundedPush(report.held, { stableKey, rule: holdback.rule, why: holdback.why });
        continue;
      }
      const expanded = expandReason(rule.set.reason, representative);
      if (expanded.missing !== null) {
        ruleReport.held += 1;
        boundedPush(report.held, {
          stableKey,
          rule: rule.name,
          why: `Reason template requires missing ${expanded.missing} evidence`,
        });
        continue;
      }

      ruleReport.wouldWrite += 1;
      candidates.push({
        stableKey,
        rule: rule.name,
        input: {
          project: scope.project,
          component: {
            purl: representative.componentPurl,
            name: representative.componentName,
            group: representative.componentGroup,
            version: representative.componentVersion,
          },
          cve: representative.cve,
          stableKey,
          status: rule.set.status,
          justification: rule.set.justification,
          response: rule.set.response,
          reason: expanded.reason,
          pin,
          provenance: {
            by: "bb-policy",
            at: evaluatedAt,
            evidence: `policy:${rule.name}; ${expanded.reason}`,
          },
        },
      });
    }
  }

  evaluatedCandidates.set(report, candidates);
  evaluatedPolicies.set(report, policyFingerprint(policy));
  evaluatedScopes.set(report, { ...scope });
  return report;
}

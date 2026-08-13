import type { VexJustification, VexStatus } from "../../../lib/remote/types.js";
import type { PolicyDecision, PolicyPredicate } from "./schema.js";

export interface PolicyFinding {
  stableKey: string;
  findingId: string;
  cve: string | null;
  componentName: string | null;
  componentGroup: string | null;
  componentVersion: string | null;
  componentPurl: string | null;
  severity: string | null;
  band: string | null;
  epssScore: number | null;
  inKev: boolean;
  inVcKev: boolean;
  reachabilityScore: number | null;
  reachabilityFactors: unknown;
  vulnInDataset: boolean | null;
  findingType: string | null;
  cwes: string[];
  vexStatus: string | null;
  vexResponse: string | null;
  vexJustification: string | null;
  vexReason: string | null;
}

export interface CompiledPredicate {
  sql: string;
  parameters: Array<string | number>;
  matches(finding: PolicyFinding, proposed?: PolicyDecision): boolean;
}

function values(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function folded(value: string | null): string | null {
  return value?.normalize("NFC").toLocaleLowerCase("en-US") ?? null;
}

function hasValue(actual: string | null, expected: string | string[]): boolean {
  const normalized = folded(actual);
  return normalized !== null && values(expected).some((item) => folded(item) === normalized);
}

function listSql(column: string, selected: string | string[], clauses: string[], parameters: Array<string | number>): void {
  const list = values(selected);
  clauses.push(`${column} COLLATE NOCASE IN (${list.map(() => "?").join(", ")})`);
  parameters.push(...list);
}

function reachabilityMatches(value: PolicyPredicate["reachability"], score: number | null): boolean {
  if (value === undefined) return true;
  if (value === "reachable") return score !== null && score > 0;
  if (value === "unreachable") return score !== null && score < 0;
  return score === null || score === 0;
}

function decisionMatches(
  predicate: PolicyPredicate,
  proposed: PolicyDecision | undefined,
): boolean {
  if (predicate.set_status !== undefined && proposed?.status !== predicate.set_status) return false;
  if ("justification" in predicate && proposed?.justification !== predicate.justification) return false;
  return true;
}

export function compilePredicate(predicate: PolicyPredicate): CompiledPredicate {
  const clauses: string[] = [];
  const parameters: Array<string | number> = [];

  if (predicate.reachability === "reachable") clauses.push("f.reachability_score > 0");
  if (predicate.reachability === "unreachable") clauses.push("f.reachability_score < 0");
  if (predicate.reachability === "unknown") clauses.push("(f.reachability_score IS NULL OR f.reachability_score = 0)");
  if (predicate.vuln_in_dataset !== undefined) {
    clauses.push("f.vuln_in_dataset = ?");
    parameters.push(predicate.vuln_in_dataset ? 1 : 0);
  }
  if (predicate.band !== undefined) listSql("f.band", predicate.band, clauses, parameters);
  if (predicate.kev !== undefined) {
    clauses.push("f.in_kev = ?");
    parameters.push(predicate.kev ? 1 : 0);
  }
  if (predicate.vc_kev !== undefined) {
    clauses.push("f.in_vc_kev = ?");
    parameters.push(predicate.vc_kev ? 1 : 0);
  }
  if (predicate.epss_gte !== undefined) {
    clauses.push("f.epss_score >= ?");
    parameters.push(predicate.epss_gte);
  }
  if (predicate.severity !== undefined) listSql("f.severity", predicate.severity, clauses, parameters);
  if (predicate.component !== undefined) {
    const list = values(predicate.component);
    const placeholders = list.map(() => "?").join(", ");
    clauses.push(`(f.component_name COLLATE NOCASE IN (${placeholders}) OR f.component_purl IN (${placeholders}))`);
    parameters.push(...list, ...list);
  }
  if (predicate.finding_type !== undefined) listSql("f.finding_type", predicate.finding_type, clauses, parameters);
  if (predicate.cwe !== undefined) {
    const list = values(predicate.cwe);
    clauses.push(`EXISTS (
      SELECT 1 FROM finding_cwes fc
       WHERE fc.project_id = f.project_id
         AND fc.project_version_id = f.project_version_id
         AND fc.generation_id = f.generation_id
         AND fc.finding_id = f.finding_id
         AND fc.cwe COLLATE NOCASE IN (${list.map(() => "?").join(", ")})
    )`);
    parameters.push(...list);
  }

  return {
    sql: clauses.length === 0 ? "1 = 1" : clauses.join(" AND "),
    parameters,
    matches(finding, proposed) {
      if (!reachabilityMatches(predicate.reachability, finding.reachabilityScore)) return false;
      if (predicate.vuln_in_dataset !== undefined && finding.vulnInDataset !== predicate.vuln_in_dataset) return false;
      if (predicate.band !== undefined && !hasValue(finding.band, predicate.band)) return false;
      if (predicate.kev !== undefined && finding.inKev !== predicate.kev) return false;
      if (predicate.vc_kev !== undefined && finding.inVcKev !== predicate.vc_kev) return false;
      if (predicate.epss_gte !== undefined && (finding.epssScore === null || finding.epssScore < predicate.epss_gte)) return false;
      if (predicate.severity !== undefined && !hasValue(finding.severity, predicate.severity)) return false;
      if (predicate.component !== undefined
        && !hasValue(finding.componentName, predicate.component)
        && !hasValue(finding.componentPurl, predicate.component)) return false;
      if (predicate.finding_type !== undefined && !hasValue(finding.findingType, predicate.finding_type)) return false;
      const selectedCwes = predicate.cwe;
      if (selectedCwes !== undefined && !finding.cwes.some((cwe) => hasValue(cwe, selectedCwes))) return false;
      return decisionMatches(predicate, proposed);
    },
  };
}

export function proposalPredicate(status: VexStatus, justification: VexJustification | null): PolicyPredicate {
  return { set_status: status, justification };
}

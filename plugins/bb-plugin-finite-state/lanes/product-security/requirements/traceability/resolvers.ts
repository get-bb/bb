import type Database from "better-sqlite3";
import { toStorageProjectVersionId } from "../../../../lib/store/index.js";
import { reqIdKey } from "../../../../lib/sync/registry.js";
import type { RequirementCardModel, RequirementYamlV1 } from "../cards/schema.js";
import { traceabilitySubPath } from "./filters.js";

export interface TraceNodeModel {
  kind:
    | "threat"
    | "requirement"
    | "clause"
    | "commit"
    | "check"
    | "run"
    | "attestation";
  id: string;
  label: string;
  ready: boolean;
  relation: string;
  provenance?: { source: string; at?: string };
  error?: string;
  navigation?: { subPath: string; label: string };
}

export interface TraceRailModel {
  requirementId: string;
  nodes: TraceNodeModel[];
  gaps: { from: string; to: string; reason: string }[];
}

export interface EvidenceSummary {
  resultId: string;
  checkId: string | null;
  runId: string | null;
  tier: string;
  status: string;
  summary: string | null;
  executedAt: string | null;
}

export interface RequirementTraceModel {
  card: RequirementCardModel;
  rail: TraceRailModel;
  evidence: EvidenceSummary[];
}

export interface GitCommitProvenance {
  hash: string;
  subject: string;
  author: string;
  at: string;
  artifactId: string;
}

interface SnapshotRow {
  entity_key: string;
  payload: string;
}

interface ClauseRow {
  standard_id: string;
  clause_id: string;
  clause_code: string;
  title: string | null;
  review_status: string | null;
  review_version: string;
  pulled_at: string;
}

interface CheckRow {
  check_id: string;
  code: string;
  name: string;
  review_status: string | null;
  review_version: string;
  pulled_at: string;
}

interface ResultRow {
  result_id: string;
  run_id: string | null;
  check_id: string | null;
  tier: string;
  status: string;
  evidence_summary: string | null;
  executed_at: string | null;
}

interface RunRow {
  run_id: string;
  matrix_col: string;
  status: string;
  started_at: string | null;
}

interface AttestationRow {
  attestation_id: string;
  run_id: string;
  verified: number;
  signer_identity: string | null;
  created_at: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringList(record: Record<string, unknown> | null, key: string): string[] {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").slice(0, 100)
    : [];
}

function snapshotFields(payload: string): Record<string, unknown> | null {
  try {
    const root = asRecord(JSON.parse(payload));
    return asRecord(root?.fields) ?? root;
  } catch {
    return null;
  }
}

function safeDetail(value: string, fallback: string): string {
  const normalized = value
    .replace(/(?:authorization|bearer\s|api[_-]?key|token=|https?:\/\/[^\s]*[?@])/giu, "[redacted]")
    .trim();
  return (normalized || fallback).slice(0, 500);
}

function gap(from: string, to: string, reason: string): TraceRailModel["gaps"][number] {
  return { from, to, reason: safeDetail(reason, "Trace target is unavailable.") };
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function resolveThreats(
  db: Database.Database,
  scope: { projectId: string; projectVersionId: string | null },
  requirement: RequirementYamlV1,
): TraceNodeModel[] {
  if (requirement.mitigations.length === 0) return [];
  const mitigations = requirement.mitigations.slice(0, 100);
  const rows = db.prepare<unknown[], SnapshotRow>(
    `SELECT DISTINCT snapshot.entity_key, snapshot.payload
       FROM base_snapshot snapshot
       JOIN sync_state state
         ON state.project_id = snapshot.project_id
        AND state.project_version_id = snapshot.project_version_id
        AND state.entity_kind = snapshot.entity_kind
        AND state.accepted_generation_id = snapshot.generation_id
       JOIN json_each(snapshot.payload, '$.fields.mitigations') mitigation
      WHERE snapshot.project_id = ? AND snapshot.project_version_id = ?
        AND snapshot.entity_kind = 'threat'
        AND mitigation.value IN (${placeholders(mitigations.length)})
      ORDER BY snapshot.entity_key
      LIMIT 20`,
  ).all(
    scope.projectId,
    toStorageProjectVersionId(scope.projectVersionId),
    ...mitigations,
  );
  const wanted = new Set(requirement.mitigations);
  return rows.flatMap((row) => {
    const fields = snapshotFields(row.payload);
    const common = stringList(fields, "mitigations").filter((value) => wanted.has(value));
    if (common.length === 0) return [];
    const id = stringField(fields, "slug") ?? stringField(fields, "id");
    if (!id) return [];
    const component = stringList(fields, "affected_components")[0];
    return [{
      kind: "threat" as const,
      id,
      label: stringField(fields, "name") ?? id,
      ready: true,
      relation: `shares mitigation ${common[0]} with this requirement`,
      provenance: { source: "accepted threat snapshot" },
      ...(component
        ? { navigation: { subPath: `tara/nodes/${component}`, label: `Focus ${component} in canvas` } }
        : { error: "Threat has no affected component available for a focused canvas link." }),
    }];
  });
}

function resolveClauses(
  db: Database.Database,
  scope: { projectId: string; projectVersionId: string | null },
  requirement: RequirementYamlV1,
): TraceNodeModel[] {
  const references = requirement.standards.slice(0, 100);
  if (references.length === 0) return [];
  const sql = `SELECT standard_id, clause_id, clause_code, title, review_status,
                      review_version, pulled_at
                 FROM standards_clauses
                WHERE project_id = ? AND project_version_id = ?
                  AND (standard_id IN (${placeholders(references.length)})
                    OR clause_id IN (${placeholders(references.length)})
                    OR clause_code IN (${placeholders(references.length)}))
                ORDER BY pulled_at DESC, standard_id, clause_code
                LIMIT 100`;
  const rows = db.prepare<unknown[], ClauseRow>(sql).all(
    scope.projectId,
    toStorageProjectVersionId(scope.projectVersionId),
    ...references,
    ...references,
    ...references,
  );
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (seen.has(row.clause_id)) return [];
    seen.add(row.clause_id);
    return [{
      kind: "clause" as const,
      id: row.clause_id,
      label: row.title ? `${row.clause_code} · ${row.title}` : row.clause_code,
      ready: true,
      relation: "mapped clause; mapping alone is not compliance proof",
      provenance: {
        source: `cached standard · review_version ${row.review_version}`,
        at: row.pulled_at,
      },
      navigation: {
        subPath: traceabilitySubPath(
          { standardClause: row.clause_id },
          requirement.id,
        ),
        label: `Inspect cached clause ${row.clause_code}`,
      },
    }];
  });
}

function resolveChecks(
  db: Database.Database,
  scope: { projectId: string; projectVersionId: string | null },
  requirement: RequirementYamlV1,
): CheckRow[] {
  const authored = requirement.verification.flatMap((contract) => contract.check ? [contract.check] : []);
  const requirementKey = reqIdKey({ reqId: requirement.id });
  const authoredSql = authored.length > 0
    ? ` OR checks.code IN (${placeholders(authored.length)})`
    : "";
  return db.prepare<unknown[], CheckRow>(
    `SELECT DISTINCT checks.check_id, checks.code, checks.name,
                     checks.review_status, checks.review_version, checks.pulled_at
       FROM verification_checks checks
       LEFT JOIN requirement_check_mappings mapping
         ON mapping.project_id = checks.project_id
        AND mapping.project_version_id = checks.project_version_id
        AND mapping.generation_id = checks.generation_id
        AND mapping.check_id = checks.check_id
      WHERE checks.project_id = ? AND checks.project_version_id = ?
        AND (mapping.requirement_key = ?${authoredSql})
      ORDER BY checks.pulled_at DESC, checks.code
      LIMIT 100`,
  ).all(
    scope.projectId,
    toStorageProjectVersionId(scope.projectVersionId),
    requirementKey,
    ...authored,
  );
}

function resolveResults(
  db: Database.Database,
  scope: { projectId: string; projectVersionId: string | null },
  requirementId: string,
): ResultRow[] {
  return db.prepare<[string, string, string], ResultRow>(
    `SELECT result_id, run_id, check_id, tier, status, evidence_summary, executed_at
       FROM verification_results
      WHERE project_id = ? AND project_version_id = ?
        AND requirement_key = ? AND is_latest = 1
      ORDER BY executed_at DESC, result_id
      LIMIT 100`,
  ).all(
    scope.projectId,
    toStorageProjectVersionId(scope.projectVersionId),
    reqIdKey({ reqId: requirementId }),
  );
}

export function resolveRequirementTrace(
  db: Database.Database,
  scope: { projectId: string; projectVersionId: string | null },
  card: RequirementCardModel,
  git: GitCommitProvenance | { error: string } | null,
): RequirementTraceModel {
  const requirement = card.requirement;
  const nodes: TraceNodeModel[] = [];
  const gaps: TraceRailModel["gaps"] = [];

  let threats: TraceNodeModel[] = [];
  try {
    threats = resolveThreats(db, scope, requirement);
    nodes.push(...threats);
  } catch (error) {
    gaps.push(gap("threat", requirement.id, `Threat cache lookup failed: ${String(error)}`));
  }
  if (threats.length === 0 && !gaps.some((item) => item.from === "threat")) {
    gaps.push(gap("threat", requirement.id, requirement.mitigations.length === 0
      ? "No mitigation reference connects a threat to this requirement. Add a reviewed mapping in authored YAML."
      : "No accepted threat snapshot shares the requirement's mitigation references. Refresh or repair the mapping."));
  }

  nodes.push({
    kind: "requirement",
    id: requirement.id,
    label: requirement.ears.text,
    ready: true,
    relation: "selected requirement",
    provenance: {
      source: card.local ? "tracked local YAML" : "accepted requirement cache",
    },
  });

  let clauses: TraceNodeModel[] = [];
  try {
    clauses = resolveClauses(db, scope, requirement);
    nodes.push(...clauses);
  } catch (error) {
    gaps.push(gap(requirement.id, "clause", `Clause cache lookup failed: ${String(error)}`));
  }
  if (clauses.length === 0 && !gaps.some((item) => item.to === "clause")) {
    gaps.push(gap(requirement.id, "clause", requirement.standards.length === 0
      ? "No standard clause is mapped. A clause link is context, not proof."
      : "Mapped clause is absent from cached standards truth. Refresh standards or repair the stable clause id."));
  }

  if (git && "hash" in git) {
    nodes.push({
      kind: "commit",
      id: git.hash,
      label: `${git.hash.slice(0, 9)} · ${git.subject}`,
      ready: true,
      relation: "latest commit touching the known requirement file",
      provenance: { source: `${git.author} · ${git.artifactId}`, at: git.at },
    });
  } else {
    gaps.push(gap(clauses[0]?.id ?? requirement.id, "commit", git?.error ??
      "No committed history exists for the tracked requirement file yet. Commit the reviewed YAML to establish provenance."));
  }

  let checks: CheckRow[] = [];
  let results: ResultRow[] = [];
  try {
    checks = resolveChecks(db, scope, requirement);
    results = resolveResults(db, scope, requirement.id);
    for (const check of checks.slice(0, 30)) {
      const contract = requirement.verification.find((item) => item.check === check.code);
      nodes.push({
        kind: "check",
        id: check.check_id,
        label: `${check.code} · ${check.name}`,
        ready: contract?.check !== null,
        relation: contract ? `${contract.required ? "required" : "optional"} ${contract.tier} contract` : "cached requirement mapping",
        provenance: {
          source: `cached check · review_version ${check.review_version}`,
          at: check.pulled_at,
        },
        navigation: {
          subPath: `verifications/${requirement.id}/${contract?.tier ?? "static"}`,
          label: "Open matrix cell",
        },
      });
    }
    const runIds = [...new Set(results.flatMap((result) => result.run_id ? [result.run_id] : []))];
    if (runIds.length > 0) {
      const runs = db.prepare<unknown[], RunRow>(
        `SELECT run_id, matrix_col, status, started_at
           FROM verification_runs
          WHERE project_id = ? AND project_version_id = ?
            AND run_id IN (${placeholders(runIds.length)})
          ORDER BY started_at DESC, run_id
          LIMIT 50`,
      ).all(scope.projectId, toStorageProjectVersionId(scope.projectVersionId), ...runIds);
      for (const run of runs) {
        nodes.push({
          kind: "run",
          id: run.run_id,
          label: `${run.matrix_col} · ${run.status}`,
          ready: run.status === "completed",
          relation: "produced latest evidence for this requirement",
          provenance: { source: "verification run cache", ...(run.started_at ? { at: run.started_at } : {}) },
          navigation: {
            subPath: `verifications/${requirement.id}/${run.matrix_col}`,
            label: "Open verification run detail",
          },
        });
      }
      const attestations = db.prepare<unknown[], AttestationRow>(
        `SELECT attestation_id, run_id, verified, signer_identity, created_at
           FROM attestations
          WHERE project_id = ? AND project_version_id = ?
            AND run_id IN (${placeholders(runIds.length)})
          ORDER BY created_at DESC, attestation_id
          LIMIT 50`,
      ).all(scope.projectId, toStorageProjectVersionId(scope.projectVersionId), ...runIds);
      for (const attestation of attestations) {
        nodes.push({
          kind: "attestation",
          id: attestation.attestation_id,
          label: attestation.attestation_id,
          ready: attestation.verified === 1,
          relation: attestation.verified === 1
            ? "signature and run subject binding verified"
            : "attestation exists but is not verified evidence",
          provenance: {
            source: attestation.signer_identity ?? "unsigned/unknown signer",
            at: attestation.created_at,
          },
          navigation: {
            subPath: `verifications/${requirement.id}/${results.find((item) => item.run_id === attestation.run_id)?.tier ?? "static"}`,
            label: "Open signed evidence",
          },
        });
      }
    }
  } catch (error) {
    gaps.push(gap("commit", "check/run", `Verification cache lookup failed: ${String(error)}`));
  }
  if (checks.length === 0) {
    gaps.push(gap(git && "hash" in git ? git.hash : requirement.id, "check", requirement.verification.some((item) => item.check === null)
      ? "An inline contract still needs check creation; no check id was invented."
      : "No cached check resolves the authored verification contract."));
  }
  if (results.length === 0) {
    gaps.push(gap(checks[0]?.check_id ?? requirement.id, "run", "No latest evidence result exists. Run a mapped verification; this view cannot mark verified."));
  }
  if (!nodes.some((node) => node.kind === "attestation")) {
    const latestRun = [...nodes].reverse().find((node) => node.kind === "run");
    gaps.push(gap(latestRun?.id ?? "run", "attestation", "No signed, digest-bound attestation is cached for the latest runs."));
  }

  return {
    card,
    rail: { requirementId: requirement.id, nodes, gaps },
    evidence: results.map((result) => ({
      resultId: result.result_id,
      checkId: result.check_id,
      runId: result.run_id,
      tier: result.tier,
      status: result.status,
      summary: result.evidence_summary,
      executedAt: result.executed_at,
    })),
  };
}

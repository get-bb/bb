import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import type { ProbeChangedHint } from "../probes/runs.js";
import { nextStep, validateVerdict } from "./escalation.js";
import type {
  CascadeDiagnosis,
  CascadeSession,
  CascadeSessionStep,
  EscalationDecision,
  Hypothesis,
  TierVerdict,
} from "./types.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CASCADE_SCRIPT_PREFIX = ".fs/bench/cascade/";

const diagnosisEvidenceSchema = z
  .object({
    kind: z.string().min(1),
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine(
        (path) =>
          path.startsWith(".fs-bench/") &&
          !path.includes("\\") &&
          path
            .split("/")
            .every(
              (segment) =>
                segment !== "" && segment !== "." && segment !== "..",
            ),
        "Diagnosis evidence must be a safe .fs-bench artifact path.",
      ),
  })
  .strict();
const annotationSchema = z
  .object({
    code: z.enum([
      "BLOB_ONLY_ANALYSIS",
      "CLASS_REQUIRES_PHYSICAL",
      "EMULATION_FAILED",
      "NONDETERMINISTIC_OUTPUT",
    ]),
    message: z.string().min(1).max(4000),
  })
  .strict();
const hypothesisSchema = z
  .object({
    id: z.string().min(1).max(512),
    text: z.string().min(1).max(2000),
    class: z.enum([
      "logic",
      "state",
      "timing",
      "power",
      "analog",
      "environmental",
    ]),
    likelihood: z.number().min(0).max(1),
    easeOfVerification: z.number().min(0).max(1),
  })
  .strict();
const verdictSchema = z
  .object({
    tier: z.enum(["d0", "d1", "d2", "d3"]),
    hypothesisId: z.string().min(1).max(512),
    outcome: z.enum(["confirmed", "refuted", "inconclusive"]),
    forcedEscalation: z.boolean(),
    evidence: z.array(diagnosisEvidenceSchema),
    producedBy: z
      .object({
        command: z.array(z.string()).min(1),
        inputs: z.record(z.string(), z.string()),
      })
      .strict(),
    annotations: z.array(annotationSchema).optional(),
    rehostingRunId: z.string().min(1).max(512).optional(),
  })
  .strict();
const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answered"), verdict: verdictSchema }).strict(),
  z
    .object({
      action: z.literal("escalate"),
      toTier: z.enum(["d0", "d1", "d2", "d3"]),
      because: z.enum(["inconclusive", "class_requires_physical"]),
    })
    .strict(),
  z.object({ action: z.literal("stop"), reason: z.string().min(1) }).strict(),
]);
const stepSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    hypothesisId: z.string().min(1).max(512),
    verdict: verdictSchema,
    decision: decisionSchema,
  })
  .strict();
const diagnosisSchema = z
  .object({
    summary: z.string().min(1).max(20_000),
    outcome: z.enum(["confirmed", "refuted", "inconclusive"]),
    evidence: z.array(diagnosisEvidenceSchema),
  })
  .strict();
const sessionEnvelopeSchema = z
  .object({
    type: z.literal("finite-state.cascade-session.v1"),
    sessionId: z.string().regex(ID),
    probeRunId: z.string().regex(ID),
    projectId: z.string().min(1).max(512),
    projectVersionId: z.string().min(1).max(512).nullable(),
    hypotheses: z.array(hypothesisSchema),
    steps: z.array(stepSchema),
    diagnosis: diagnosisSchema.nullable(),
    revision: z.number().int().nonnegative(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
  })
  .strict();

interface SessionRow {
  run_id: string;
  hypothesis: string | null;
  artifacts: string | null;
}

interface SessionPageRow extends SessionRow {
  started_at: string;
}

export interface CascadeSessionDeps {
  db: Database.Database;
  artifacts: {
    read(path: string): string | null;
    write(path: string, contents: string): void;
  };
  now(): Date;
  publish(channel: "probe:changed", payload: ProbeChangedHint): void;
}

export interface CreateCascadeSessionInput {
  sessionId: string;
  projectId: string;
  projectVersionId: string | null;
  hypotheses: readonly Hypothesis[];
}

function parseSession(value: string | null): CascadeSession {
  if (value === null) throw new Error("CASCADE_SESSION_INVALID");
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    throw new Error("CASCADE_SESSION_INVALID");
  }
  const parsed = sessionEnvelopeSchema.safeParse(json);
  if (!parsed.success) throw new Error("CASCADE_SESSION_INVALID");
  const { type: _type, ...session } = parsed.data;
  return session;
}

function serializeSession(session: CascadeSession): string {
  return JSON.stringify({
    type: "finite-state.cascade-session.v1",
    ...session,
  });
}

function parseArtifactPaths(value: string | null): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? "[]");
  } catch {
    throw new Error("CASCADE_SESSION_INVALID");
  }
  const result = z.array(diagnosisEvidenceSchema.shape.path).safeParse(parsed);
  if (!result.success || result.data.length === 0) {
    throw new Error("CASCADE_SESSION_INVALID");
  }
  return result.data;
}

function sessionArtifactPath(
  runId: string,
  revision: number,
  contents: string,
): string {
  if (!ID.test(runId) || !Number.isInteger(revision) || revision < 0) {
    throw new Error("INVALID_CASCADE_SESSION_ID");
  }
  const digest = createHash("sha256")
    .update(contents)
    .digest("hex")
    .slice(0, 16);
  return `.fs-bench/probe-runs/${runId}/cascade-session-r${revision}-${digest}.json`;
}

function readSession(
  deps: Pick<CascadeSessionDeps, "artifacts">,
  row: SessionRow,
): CascadeSession {
  const [path] = parseArtifactPaths(row.artifacts);
  return parseSession(deps.artifacts.read(path) ?? null);
}

function scriptPath(sessionId: string): string {
  if (!ID.test(sessionId)) throw new Error("INVALID_CASCADE_SESSION_ID");
  return `${CASCADE_SCRIPT_PREFIX}${sessionId}.json`;
}

function rowFor(
  db: Database.Database,
  projectId: string,
  projectVersionId: string | null,
  sessionId: string,
): SessionRow | undefined {
  return db
    .prepare<[string, string, string], SessionRow>(
      `SELECT run_id, hypothesis, artifacts FROM probe_run
       WHERE project_id = ? AND project_version_id = ? AND script_path = ?`,
    )
    .get(
      projectId,
      toStorageProjectVersionId(projectVersionId),
      scriptPath(sessionId),
    );
}

export function createCascadeSession(
  deps: CascadeSessionDeps,
  input: CreateCascadeSessionInput,
): CascadeSession {
  const startedAt = deps.now().toISOString();
  const probeRunId = `cascade-${input.sessionId}`;
  if (!ID.test(probeRunId)) throw new Error("INVALID_CASCADE_SESSION_ID");
  const hypotheses = input.hypotheses.map((hypothesis) =>
    hypothesisSchema.parse(hypothesis),
  );
  if (hypotheses.length === 0) {
    throw new Error("CASCADE_HYPOTHESIS_REQUIRED");
  }
  if (
    new Set(hypotheses.map((hypothesis) => hypothesis.id)).size !==
    hypotheses.length
  ) {
    throw new Error("CASCADE_HYPOTHESIS_DUPLICATE");
  }
  const session: CascadeSession = {
    sessionId: input.sessionId,
    probeRunId,
    projectId: input.projectId,
    projectVersionId: input.projectVersionId,
    hypotheses,
    steps: [],
    diagnosis: null,
    revision: 0,
    startedAt,
    finishedAt: null,
  };
  const serialized = serializeSession(session);
  const artifactPath = sessionArtifactPath(
    probeRunId,
    session.revision,
    serialized,
  );
  deps.db
    .transaction(() => {
      deps.artifacts.write(artifactPath, serialized);
      deps.db
        .prepare(
          `INSERT INTO probe_run (
             project_id, project_version_id, run_id, script_path, devices,
             hypothesis, outcome, artifacts, started_at, finished_at
           ) VALUES (?, ?, ?, ?, '[]', ?, NULL, ?, ?, NULL)`,
        )
        .run(
          input.projectId,
          toStorageProjectVersionId(input.projectVersionId),
          probeRunId,
          scriptPath(input.sessionId),
          hypotheses[0]!.text,
          JSON.stringify([artifactPath]),
          startedAt,
        );
    })
    .immediate();
  deps.publish("probe:changed", {
    projectId: input.projectId,
    projectVersionId: input.projectVersionId,
    runId: probeRunId,
  });
  return session;
}

function updateSession(
  deps: CascadeSessionDeps,
  scope: Pick<CascadeSession, "projectId" | "projectVersionId" | "sessionId">,
  update: (session: CascadeSession) => CascadeSession,
): CascadeSession {
  const result = deps.db
    .transaction(() => {
      const row = rowFor(
        deps.db,
        scope.projectId,
        scope.projectVersionId,
        scope.sessionId,
      );
      if (!row) throw new Error("CASCADE_SESSION_NOT_FOUND");
      const previous = readSession(deps, row);
      if (previous.finishedAt !== null)
        throw new Error("CASCADE_SESSION_FINISHED");
      const next = update(previous);
      const serialized = serializeSession(next);
      const previousArtifacts = parseArtifactPaths(row.artifacts);
      const artifactPath = sessionArtifactPath(
        row.run_id,
        next.revision,
        serialized,
      );
      const nextArtifacts = [artifactPath, ...previousArtifacts.slice(1)];
      deps.artifacts.write(artifactPath, serialized);
      const changed = deps.db
        .prepare(
          `UPDATE probe_run SET artifacts = ?
         WHERE project_id = ? AND project_version_id = ? AND run_id = ? AND artifacts = ?`,
        )
        .run(
          JSON.stringify(nextArtifacts),
          scope.projectId,
          toStorageProjectVersionId(scope.projectVersionId),
          row.run_id,
          row.artifacts,
        ).changes;
      if (changed !== 1) throw new Error("CASCADE_SESSION_STALE");
      return next;
    })
    .immediate();
  deps.publish("probe:changed", {
    projectId: result.projectId,
    projectVersionId: result.projectVersionId,
    runId: result.probeRunId,
  });
  return result;
}

export function addCascadeHypothesis(
  deps: CascadeSessionDeps,
  scope: Pick<CascadeSession, "projectId" | "projectVersionId" | "sessionId">,
  hypothesis: Hypothesis,
): CascadeSession {
  const validated = hypothesisSchema.parse(hypothesis);
  return updateSession(deps, scope, (session) => {
    if (session.hypotheses.some((item) => item.id === validated.id)) {
      throw new Error("CASCADE_HYPOTHESIS_DUPLICATE");
    }
    return {
      ...session,
      hypotheses: [...session.hypotheses, validated],
      revision: session.revision + 1,
    };
  });
}

export function recordCascadeStep(
  deps: CascadeSessionDeps,
  scope: Pick<CascadeSession, "projectId" | "projectVersionId" | "sessionId">,
  verdict: TierVerdict,
): CascadeSession {
  return updateSession(deps, scope, (session) => {
    const hypothesis = session.hypotheses.find(
      (item) => item.id === verdict.hypothesisId,
    );
    if (!hypothesis) {
      throw new Error("CASCADE_HYPOTHESIS_NOT_FOUND");
    }
    const validatedVerdict = verdictSchema.parse(
      validateVerdict(verdict, hypothesis),
    );
    const previousVerdicts = session.steps
      .filter((step) => step.hypothesisId === hypothesis.id)
      .map((step) => step.verdict);
    const validatedDecision: EscalationDecision = decisionSchema.parse(
      nextStep(hypothesis, [...previousVerdicts, validatedVerdict]),
    );
    const step: CascadeSessionStep = {
      sequence: session.steps.length,
      hypothesisId: verdict.hypothesisId,
      verdict: validatedVerdict,
      decision: validatedDecision,
    };
    return {
      ...session,
      steps: [...session.steps, step],
      revision: session.revision + 1,
    };
  });
}

export function finishCascadeSession(
  deps: CascadeSessionDeps,
  scope: Pick<CascadeSession, "projectId" | "projectVersionId" | "sessionId">,
  diagnosis: CascadeDiagnosis,
): CascadeSession {
  const validatedDiagnosis = diagnosisSchema.parse(diagnosis);
  const finishedAt = deps.now().toISOString();
  const result = deps.db
    .transaction(() => {
      const row = rowFor(
        deps.db,
        scope.projectId,
        scope.projectVersionId,
        scope.sessionId,
      );
      if (!row) throw new Error("CASCADE_SESSION_NOT_FOUND");
      const previous = readSession(deps, row);
      if (previous.finishedAt !== null)
        throw new Error("CASCADE_SESSION_FINISHED");
      const next: CascadeSession = {
        ...previous,
        diagnosis: validatedDiagnosis,
        revision: previous.revision + 1,
        finishedAt,
      };
      const diagnosisArtifacts = [
        ...new Set(validatedDiagnosis.evidence.map((item) => item.path)),
      ];
      const serialized = serializeSession(next);
      const sessionArtifact = sessionArtifactPath(
        row.run_id,
        next.revision,
        serialized,
      );
      const artifacts = [sessionArtifact, ...diagnosisArtifacts];
      deps.artifacts.write(sessionArtifact, serialized);
      const changed = deps.db
        .prepare(
          `UPDATE probe_run
         SET outcome = ?, artifacts = ?, finished_at = ?
         WHERE project_id = ? AND project_version_id = ? AND run_id = ?
           AND artifacts = ? AND finished_at IS NULL`,
        )
        .run(
          validatedDiagnosis.outcome,
          JSON.stringify(artifacts),
          finishedAt,
          scope.projectId,
          toStorageProjectVersionId(scope.projectVersionId),
          row.run_id,
          row.artifacts,
        ).changes;
      if (changed !== 1) throw new Error("CASCADE_SESSION_STALE");
      return next;
    })
    .immediate();
  deps.publish("probe:changed", {
    projectId: result.projectId,
    projectVersionId: result.projectVersionId,
    runId: result.probeRunId,
  });
  return result;
}

export function replayCascadeSession(
  deps: Pick<CascadeSessionDeps, "db" | "artifacts">,
  scope: Pick<CascadeSession, "projectId" | "projectVersionId" | "sessionId">,
): CascadeSession {
  const row = rowFor(
    deps.db,
    scope.projectId,
    scope.projectVersionId,
    scope.sessionId,
  );
  if (!row) throw new Error("CASCADE_SESSION_NOT_FOUND");
  return readSession(deps, row);
}

interface CascadeSessionCursor {
  startedAt: string;
  runId: string;
}

function decodeCursor(cursor: string | null): CascadeSessionCursor | null {
  if (cursor === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_CASCADE_SESSION_CURSOR");
  }
  const parsed = z
    .object({ startedAt: z.iso.datetime(), runId: z.string().regex(ID) })
    .strict()
    .safeParse(value);
  if (!parsed.success) throw new Error("INVALID_CASCADE_SESSION_CURSOR");
  return parsed.data;
}

export function listCascadeSessions(
  deps: Pick<CascadeSessionDeps, "db" | "artifacts">,
  input: {
    projectId: string;
    projectVersionId: string | null;
    pageSize: number;
    cursor: string | null;
  },
): { items: CascadeSession[]; total: number; cursor: string | null } {
  if (
    !Number.isInteger(input.pageSize) ||
    input.pageSize < 1 ||
    input.pageSize > 100
  ) {
    throw new Error("INVALID_CASCADE_SESSION_PAGE_SIZE");
  }
  const cursor = decodeCursor(input.cursor);
  const scope = [
    input.projectId,
    toStorageProjectVersionId(input.projectVersionId),
  ];
  const cursorSql = cursor
    ? "AND (started_at < ? OR (started_at = ? AND run_id < ?))"
    : "";
  const params = cursor
    ? [...scope, cursor.startedAt, cursor.startedAt, cursor.runId]
    : scope;
  const rows = deps.db
    .prepare<(string | number)[], SessionPageRow>(
      `SELECT run_id, hypothesis, artifacts, started_at FROM probe_run
       WHERE project_id = ? AND project_version_id = ?
         AND script_path LIKE '${CASCADE_SCRIPT_PREFIX}%'
         ${cursorSql}
       ORDER BY started_at DESC, run_id DESC LIMIT ?`,
    )
    .all(...params, input.pageSize + 1);
  const total =
    deps.db
      .prepare<[string, string], { count: number }>(
        `SELECT count(*) AS count FROM probe_run
         WHERE project_id = ? AND project_version_id = ?
           AND script_path LIKE '${CASCADE_SCRIPT_PREFIX}%'`,
      )
      .get(scope[0], scope[1])?.count ?? 0;
  const visible = rows.slice(0, input.pageSize);
  const last = visible.at(-1);
  return {
    items: visible.map((row) => readSession(deps, row)),
    total,
    cursor:
      rows.length > input.pageSize && last
        ? Buffer.from(
            JSON.stringify({ startedAt: last.started_at, runId: last.run_id }),
            "utf8",
          ).toString("base64url")
        : null,
  };
}

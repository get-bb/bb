import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";

import { readOverlayFiles } from "../overlay/reader.js";
import { stableKeyFor, type DecisionInput, type TriageOverlayV1 } from "../overlay/schema.js";
import { setDecision as writeDecision } from "../overlay/writer.js";
import {
  assertReusableEvaluation,
  candidatesFor,
  evaluatePolicy,
  overlayIndexReader,
  type OverlayReader,
  type PolicyScope,
} from "./evaluate.js";
import { boundedPush, type PolicyReport } from "./report.js";
import { parseTriagePolicy, parseTriagePolicyText, type TriagePolicyV1 } from "./schema.js";

const MAX_POLICY_BYTES = 1024 * 1024;
const LOCK_RETRY_LIMIT = 4;

export interface PolicyDeps {
  db: Database.Database;
  root: string;
  policy?: TriagePolicyV1;
  overlay?: OverlayReader;
  expectedPolicySha256?: string;
  setDecision?: typeof writeDecision;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  signal?: AbortSignal;
  evaluated?: PolicyReport;
}

export class PolicyApplyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PolicyApplyError";
  }
}

interface LoadedPolicy {
  policy: TriagePolicyV1;
  sha256: string;
}

interface ExistingState {
  exists: boolean;
  expectedFileSha256: string | undefined;
  error: string | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sameComponent(left: TriageOverlayV1["component"], right: TriageOverlayV1["component"]): boolean {
  return left.purl === right.purl
    && left.name === right.name
    && left.group === right.group
    && left.version === right.version;
}

async function loadPolicy(deps: PolicyDeps): Promise<LoadedPolicy> {
  if (deps.policy !== undefined) {
    const policy = parseTriagePolicy(deps.policy);
    const encoded = JSON.stringify(policy);
    return { policy, sha256: sha256(encoded) };
  }
  if (!isAbsolute(deps.root)) throw new PolicyApplyError("POLICY_ROOT_INVALID", "Policy root must be absolute");
  const root = await realpath(deps.root);
  const path = resolve(root, ".fs", "triage", "policy.yaml");
  const metadata = await lstat(path).catch((error: unknown) => {
    throw new PolicyApplyError("POLICY_NOT_FOUND", error instanceof Error ? error.message : String(error));
  });
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new PolicyApplyError("POLICY_PATH_INVALID", "Policy must be a regular file, not a symlink");
  }
  if (metadata.size > MAX_POLICY_BYTES) throw new PolicyApplyError("POLICY_TOO_LARGE", `Policy exceeds ${MAX_POLICY_BYTES} bytes`);
  const canonical = await realpath(path);
  const fromRoot = relative(root, canonical);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot) || canonical === root || !canonical.startsWith(`${root}${sep}`)) {
    throw new PolicyApplyError("POLICY_PATH_INVALID", "Policy path escapes the worktree root");
  }
  const text = await readFile(canonical, "utf8");
  return { policy: parseTriagePolicyText(text), sha256: sha256(text) };
}

function copyReport(report: PolicyReport): PolicyReport {
  return {
    runId: report.runId,
    dryRun: report.dryRun,
    rules: report.rules.map((rule) => ({ ...rule, samples: [...rule.samples] })),
    written: report.written,
    held: report.held.map((hold) => ({ ...hold })),
    skippedExisting: report.skippedExisting,
    errors: report.errors.map((error) => ({ ...error })),
  };
}

function assertPolicyCas(expected: string | undefined, actual: string): void {
  if (expected !== undefined && expected !== actual) {
    throw new PolicyApplyError("POLICY_CAS_CONFLICT", "Policy changed after preview; evaluate it again before applying");
  }
}

function serverDecisionExists(db: Database.Database, scope: PolicyScope, stableKey: string): boolean {
  return db.prepare(
    `SELECT 1
       FROM findings f
       JOIN sync_state s
         ON s.project_id = f.project_id
        AND s.project_version_id = f.project_version_id
        AND s.entity_kind = 'finding'
        AND s.accepted_generation_id = f.generation_id
      WHERE f.project_id = ? AND f.project_version_id = ?
        AND f.stable_key = ? AND f.soft_deleted = 0
        AND (f.vex_status IS NOT NULL OR f.vex_response IS NOT NULL
          OR f.vex_justification IS NOT NULL OR f.vex_reason IS NOT NULL)
      LIMIT 1`,
  ).get(scope.projectId, scope.projectVersionId, stableKey) !== undefined;
}

async function localExistingState(root: string, input: DecisionInput): Promise<ExistingState> {
  const parsed = await readOverlayFiles(root);
  const projectPrefix = `.fs/triage/${input.project}/`;
  const projectError = parsed.errors.find((error) => error.file.startsWith(projectPrefix));
  if (projectError !== undefined) {
    return {
      exists: false,
      expectedFileSha256: undefined,
      error: `Overlay contains invalid YAML: ${projectError.file}`,
    };
  }
  let expectedFileSha256: string | undefined;
  for (const file of parsed.files) {
    if (file.overlay.project !== input.project) continue;
    for (const cve of Object.keys(file.overlay.decisions)) {
      if (stableKeyFor(file.overlay.project, file.overlay.component, cve) === input.stableKey) {
        return { exists: true, expectedFileSha256: file.sha256, error: null };
      }
    }
    if (sameComponent(file.overlay.component, input.component)) expectedFileSha256 = file.sha256;
  }
  return { exists: false, expectedFileSha256, error: null };
}

async function currentOverlayReader(
  db: Database.Database,
  root: string,
  scope: PolicyScope,
): Promise<OverlayReader> {
  const parsed = await readOverlayFiles(root);
  const projectPrefix = `.fs/triage/${scope.project}/`;
  const projectError = parsed.errors.find((error) => error.file.startsWith(projectPrefix));
  if (projectError !== undefined) {
    throw new PolicyApplyError("OVERLAY_READ_INVALID", `Overlay contains invalid YAML: ${projectError.file}`);
  }
  const authored = new Set<string>();
  for (const file of parsed.files) {
    if (file.overlay.project !== scope.project) continue;
    for (const cve of Object.keys(file.overlay.decisions)) {
      authored.add(stableKeyFor(file.overlay.project, file.overlay.component, cve));
    }
  }
  const indexed = overlayIndexReader(db);
  return {
    hasDecision(candidateScope, stableKey) {
      return authored.has(stableKey) || indexed.hasDecision(candidateScope, stableKey);
    },
  };
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolvePromise, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return "POLICY_WRITE_FAILED";
}

async function writeWithLockRetry(
  deps: PolicyDeps,
  input: DecisionInput,
  expectedSha256: string | undefined,
): Promise<void> {
  const setDecision = deps.setDecision ?? writeDecision;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  for (let attempt = 0; ; attempt += 1) {
    deps.signal?.throwIfAborted();
    try {
      await setDecision(deps.root, input, expectedSha256);
      return;
    } catch (error) {
      if (errorCode(error) !== "OVERLAY_LOCK_HELD" || attempt >= LOCK_RETRY_LIMIT) throw error;
      const exponential = Math.min(250, 10 * (2 ** attempt));
      const jitter = Math.floor(random() * 11);
      await sleep(exponential + jitter, deps.signal);
    }
  }
}

function persistReport(
  db: Database.Database,
  scope: PolicyScope,
  report: PolicyReport,
  policySha256: string,
  errorCount: number,
): void {
  const held = report.rules.reduce((total, rule) => total + rule.held, 0);
  const conflicts = report.errors.filter((error) => error.code === "OVERLAY_CAS_CONFLICT").length;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO triage_runs
      (project_id, project_version_id, run_id, source, dry_run, status,
       input_digest, written, held, conflicts, skipped_existing, errors,
       report_json, created_at, finished_at)
     VALUES (?, ?, ?, 'policy', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    scope.projectId,
    scope.projectVersionId,
    report.runId,
    errorCount === 0 ? "completed" : "partial",
    policySha256,
    report.written,
    held,
    conflicts,
    report.skippedExisting,
    errorCount,
    JSON.stringify(report),
    now,
    now,
  );
}

export async function applyPolicy(
  deps: PolicyDeps,
  scope: PolicyScope,
  options: { dryRun: boolean },
): Promise<PolicyReport> {
  const loaded = await loadPolicy(deps);
  assertPolicyCas(deps.expectedPolicySha256, loaded.sha256);
  if (deps.evaluated !== undefined) {
    try {
      assertReusableEvaluation(deps.evaluated, loaded.policy, scope);
    } catch (error) {
      throw new PolicyApplyError("POLICY_EVALUATION_STALE", error instanceof Error ? error.message : String(error));
    }
  }
  const overlay = deps.overlay ?? await currentOverlayReader(deps.db, deps.root, scope);
  const evaluated = deps.evaluated
    ?? evaluatePolicy(deps.db, overlay, loaded.policy, scope);
  const candidates = candidatesFor(evaluated);
  const report = deps.evaluated === undefined ? evaluated : copyReport(evaluated);
  if (options.dryRun) return report;

  report.dryRun = false;
  let errorCount = 0;
  for (const candidate of candidates) {
    deps.signal?.throwIfAborted();
    const local = await localExistingState(deps.root, candidate.input);
    if (local.error !== null) {
      errorCount += 1;
      boundedPush(report.errors, { stableKey: candidate.stableKey, code: "OVERLAY_READ_INVALID", message: local.error });
      continue;
    }
    if (local.exists || serverDecisionExists(deps.db, scope, candidate.stableKey)) {
      report.skippedExisting += 1;
      continue;
    }
    try {
      await writeWithLockRetry(deps, candidate.input, local.expectedFileSha256);
      report.written += 1;
    } catch (error) {
      errorCount += 1;
      const code = errorCode(error);
      boundedPush(report.errors, {
        stableKey: candidate.stableKey,
        code,
        message: `${code === "OVERLAY_CAS_CONFLICT" ? "Retryable conflict: " : ""}${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  persistReport(deps.db, scope, report, loaded.sha256, errorCount);
  return report;
}

import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";

import { readOverlayFiles } from "../overlay/reader.js";
import { stableKeyFor, type DecisionInput, type TriageOverlayV1 } from "../overlay/schema.js";
import {
  setDecision as writeDecision,
  type OverlayWriteResult,
} from "../overlay/writer.js";
import {
  assertReusableEvaluation,
  candidatesFor,
  evaluatePolicy,
  overlayIndexReader,
  policyFingerprint,
  type OverlayReader,
  type PolicyScope,
} from "./evaluate.js";
import { boundedPush, type PolicyReport } from "./report.js";
import { parseTriagePolicy, parseTriagePolicyText, type TriagePolicyV1 } from "./schema.js";

const MAX_POLICY_BYTES = 1024 * 1024;
const LOCK_RETRY_LIMIT = 13;
const LOCK_RETRY_MAX_DELAY_MS = 5_000;

export interface PolicyDeps {
  db: Database.Database;
  root: string;
  policy?: TriagePolicyV1;
  overlay?: OverlayReader;
  setDecision?: typeof writeDecision;
  readOverlays?: typeof readOverlayFiles;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  signal?: AbortSignal;
}

export type PolicyApplyOptions =
  | { dryRun: true }
  | { dryRun: false; expectedPolicySha256: string; evaluated: PolicyReport };

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
}

interface OverlaySnapshot {
  reader: OverlayReader;
  state(input: DecisionInput): ExistingState;
  record(input: DecisionInput, result: OverlayWriteResult): void;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function componentIdentity(component: TriageOverlayV1["component"]): string {
  return JSON.stringify([component.purl, component.name, component.group, component.version]);
}

function canonicalPolicy(policy: TriagePolicyV1): LoadedPolicy {
  return { policy, sha256: sha256(policyFingerprint(policy)) };
}

async function loadPolicy(deps: PolicyDeps): Promise<LoadedPolicy> {
  if (deps.policy !== undefined) return canonicalPolicy(parseTriagePolicy(deps.policy));
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
  return canonicalPolicy(parseTriagePolicyText(await readFile(canonical, "utf8")));
}

function copyReport(report: PolicyReport): PolicyReport {
  return {
    runId: report.runId,
    policySha256: report.policySha256,
    dryRun: report.dryRun,
    rules: report.rules.map((rule) => ({ ...rule, samples: [...rule.samples] })),
    written: report.written,
    held: report.held.map((hold) => ({ ...hold })),
    skippedExisting: report.skippedExisting,
    errors: report.errors.map((error) => ({ ...error })),
  };
}

function assertPolicyCas(expected: string, actual: string): void {
  if (!/^[a-f0-9]{64}$/u.test(expected)) {
    throw new PolicyApplyError("POLICY_PREVIEW_REQUIRED", "Apply requires the lowercase policy SHA-256 returned by preview");
  }
  if (expected !== actual) {
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

async function loadOverlaySnapshot(deps: PolicyDeps, scope: PolicyScope): Promise<OverlaySnapshot> {
  const parsed = await (deps.readOverlays ?? readOverlayFiles)(deps.root);
  const projectPrefix = `.fs/triage/${scope.project}/`;
  const projectError = parsed.errors.find((error) => error.file.startsWith(projectPrefix));
  if (projectError !== undefined) {
    throw new PolicyApplyError("OVERLAY_READ_INVALID", `Overlay contains invalid YAML: ${projectError.file}`);
  }
  const authored = new Set<string>();
  const componentSha256 = new Map<string, string>();
  for (const file of parsed.files) {
    if (file.overlay.project !== scope.project) continue;
    componentSha256.set(componentIdentity(file.overlay.component), file.sha256);
    for (const cve of Object.keys(file.overlay.decisions)) {
      authored.add(stableKeyFor(file.overlay.project, file.overlay.component, cve));
    }
  }
  const indexed = overlayIndexReader(deps.db);
  const reader: OverlayReader = {
    hasDecision(candidateScope, stableKey) {
      return authored.has(stableKey) || indexed.hasDecision(candidateScope, stableKey);
    },
  };
  return {
    reader,
    state(input) {
      return {
        exists: reader.hasDecision(scope, input.stableKey),
        expectedFileSha256: componentSha256.get(componentIdentity(input.component)),
      };
    },
    record(input, result) {
      authored.add(input.stableKey);
      componentSha256.set(componentIdentity(input.component), result.afterSha256);
    },
  };
}

function combinedReader(left: OverlayReader | undefined, right: OverlayReader): OverlayReader {
  if (left === undefined) return right;
  return {
    hasDecision(scope, stableKey) {
      return left.hasDecision(scope, stableKey) || right.hasDecision(scope, stableKey);
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
): Promise<OverlayWriteResult> {
  const setDecision = deps.setDecision ?? writeDecision;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  for (let attempt = 0; ; attempt += 1) {
    deps.signal?.throwIfAborted();
    try {
      return await setDecision(deps.root, input, expectedSha256);
    } catch (error) {
      if (errorCode(error) !== "OVERLAY_LOCK_HELD" || attempt >= LOCK_RETRY_LIMIT) throw error;
      const exponential = Math.min(LOCK_RETRY_MAX_DELAY_MS, 25 * (2 ** attempt));
      const jitter = Math.floor(random() * 26);
      await sleep(exponential + jitter, deps.signal);
    }
  }
}

function persistReport(
  db: Database.Database,
  scope: PolicyScope,
  report: PolicyReport,
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
    report.policySha256,
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

function requireApplyPreview(options: PolicyApplyOptions): void {
  if (options.dryRun) return;
  if (typeof options.expectedPolicySha256 !== "string" || options.evaluated === undefined) {
    throw new PolicyApplyError("POLICY_PREVIEW_REQUIRED", "Apply requires the exact candidate report and policy digest returned by preview");
  }
}

export async function applyPolicy(
  deps: PolicyDeps,
  scope: PolicyScope,
  options: PolicyApplyOptions,
): Promise<PolicyReport> {
  requireApplyPreview(options);
  const loaded = await loadPolicy(deps);
  const snapshot = await loadOverlaySnapshot(deps, scope);
  const overlay = combinedReader(deps.overlay, snapshot.reader);
  if (options.dryRun) return evaluatePolicy(deps.db, overlay, loaded.policy, scope);

  assertPolicyCas(options.expectedPolicySha256, loaded.sha256);
  try {
    assertReusableEvaluation(options.evaluated, loaded.policy, scope);
  } catch (error) {
    throw new PolicyApplyError("POLICY_EVALUATION_STALE", error instanceof Error ? error.message : String(error));
  }
  const candidates = candidatesFor(options.evaluated);
  const report = copyReport(options.evaluated);
  report.dryRun = false;
  let errorCount = 0;
  for (const candidate of candidates) {
    deps.signal?.throwIfAborted();
    const local = snapshot.state(candidate.input);
    if (local.exists || serverDecisionExists(deps.db, scope, candidate.stableKey)) {
      report.skippedExisting += 1;
      continue;
    }
    try {
      const result = await writeWithLockRetry(deps, candidate.input, local.expectedFileSha256);
      snapshot.record(candidate.input, result);
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
  persistReport(deps.db, scope, report, errorCount);
  return report;
}

/**
 * Environment authoring — the admission gate for sub-agent-designed tasks.
 *
 * Sub-agents propose RL environments: an instruction, a Dockerfile, a verifier, an
 * oracle patch, and F2P/P2P test lists. That is a generative act, and a generative act
 * with a reward attached is exactly where a self-training loop rots. A model that
 * authors its own tasks will, unsupervised, drift toward tasks it already passes.
 *
 * So no proposal enters the dataset on the strength of being *produced*. It enters on
 * the strength of two executions, both of which must be observed:
 *
 *   - **base run** — the verifier against the unmodified repo. The F2P tests MUST fail.
 *     If they already pass, the task teaches nothing: reward is free.
 *   - **oracle run** — the verifier with the oracle patch applied. The F2P tests MUST
 *     pass and the P2P tests MUST still pass. If the oracle cannot solve it, the task
 *     is unsolvable or the verifier is wrong; either way a trainer would be optimizing
 *     against noise.
 *
 * This is Repo2RLEnv's own reward contract read backwards ([S21], `_pr_runtime_verifier`:
 * `reward = f2p_rate * p2p_rate`). A task is admissible exactly when that formula yields
 * 0 on base and 1 on oracle. Everything here is pure: it scores probe results that the
 * caller obtained by actually running the verifier. It never infers an outcome it did
 * not observe.
 */

import { contentHash, type HarborTask } from "../harbor/harbor.ts";

/** Outcome of running a verifier once, in Harbor's F2P/P2P vocabulary ([S21]). */
export interface ProbeResult {
  /** Test ids that must go from failing to passing. */
  readonly failToPass: Readonly<Record<string, boolean>>;
  /** Test ids that must keep passing (the regression guard). */
  readonly passToPass: Readonly<Record<string, boolean>>;
  /** True when the verifier itself failed to execute (image build, timeout, crash). */
  readonly verifierErrored?: boolean;
  /** Optional free-text diagnostic carried into the rejection reason. */
  readonly detail?: string;
}

export interface TaskProposal {
  readonly task: HarborTask;
  /** Which sub-agent authored this, retained for provenance in the manifest. */
  readonly authoredBy: string;
  readonly baseProbe: ProbeResult;
  readonly oracleProbe: ProbeResult;
}

export type RejectionCode =
  | "verifier_errored"
  | "no_f2p_tests"
  | "trivially_passing"
  | "oracle_fails"
  | "oracle_regresses"
  | "empty_oracle_diff"
  | "missing_instruction";

export interface Rejection {
  readonly code: RejectionCode;
  readonly message: string;
}

export interface Admission {
  readonly admitted: boolean;
  readonly rejections: readonly Rejection[];
  /** Content hash of the admitted task, for dedup across authoring runs. */
  readonly contentHash: string;
  /** f2p_rate * p2p_rate on the base repo. Must be 0 to admit. */
  readonly baseReward: number;
  /** f2p_rate * p2p_rate with the oracle patch. Must be 1 to admit. */
  readonly oracleReward: number;
}

function rate(results: Readonly<Record<string, boolean>>): number {
  const keys = Object.keys(results);
  if (keys.length === 0) return 1; // "no P2P tests" is a pass, per the verifier ([S21]).
  let passed = 0;
  for (const key of keys) if (results[key] === true) passed += 1;
  return passed / keys.length;
}

/** Harbor's reward: `f2p_rate * p2p_rate` ([S21], `_pr_runtime_verifier.py`). */
export function probeReward(probe: ProbeResult): number {
  return rate(probe.failToPass) * rate(probe.passToPass);
}

/**
 * Decide whether a proposed environment may enter the dataset.
 *
 * Collects every reason rather than short-circuiting: an author agent fixing one
 * problem at a time across N round trips is the slow path, and the rejections are the
 * feedback signal that makes sub-agent authoring converge.
 */
export function admitTask(proposal: TaskProposal): Admission {
  const rejections: Rejection[] = [];
  const { task, baseProbe, oracleProbe } = proposal;

  if (task.instruction.trim() === "") {
    rejections.push({
      code: "missing_instruction",
      message: "instruction is empty; there is no task to perform",
    });
  }

  if (task.oracleDiff.trim() === "") {
    rejections.push({
      code: "empty_oracle_diff",
      message: "oracle diff is empty; nothing demonstrates the task is solvable",
    });
  }

  if (baseProbe.verifierErrored === true || oracleProbe.verifierErrored === true) {
    const which = baseProbe.verifierErrored === true ? "base" : "oracle";
    const detail =
      (baseProbe.verifierErrored === true ? baseProbe.detail : oracleProbe.detail) ??
      "no detail";
    rejections.push({
      code: "verifier_errored",
      message: `the ${which} verifier run did not complete (${detail}); its result cannot be trusted`,
    });
  }

  const f2pCount = Object.keys(baseProbe.failToPass).length;
  if (f2pCount === 0) {
    rejections.push({
      code: "no_f2p_tests",
      message: "no fail-to-pass tests; nothing distinguishes a solution from a no-op",
    });
  }

  const baseReward = probeReward(baseProbe);
  const oracleReward = probeReward(oracleProbe);

  // Any F2P test passing before the work is done means partial free reward.
  const alreadyPassing = Object.entries(baseProbe.failToPass)
    .filter(([, passed]) => passed)
    .map(([id]) => id);
  if (alreadyPassing.length > 0) {
    rejections.push({
      code: "trivially_passing",
      message: `fail-to-pass tests already pass on the base repo: ${alreadyPassing.join(", ")}`,
    });
  }

  const oracleFailures = Object.entries(oracleProbe.failToPass)
    .filter(([, passed]) => !passed)
    .map(([id]) => id);
  if (oracleFailures.length > 0) {
    rejections.push({
      code: "oracle_fails",
      message: `the oracle patch does not make these pass: ${oracleFailures.join(", ")}`,
    });
  }

  const regressions = Object.entries(oracleProbe.passToPass)
    .filter(([, passed]) => !passed)
    .map(([id]) => id);
  if (regressions.length > 0) {
    rejections.push({
      code: "oracle_regresses",
      message: `the oracle patch regresses pass-to-pass tests: ${regressions.join(", ")}`,
    });
  }

  return {
    admitted: rejections.length === 0,
    rejections,
    contentHash: contentHash({ instruction: task.instruction, oracleDiff: task.oracleDiff }),
    baseReward,
    oracleReward,
  };
}

export interface AdmittedTask {
  readonly proposal: TaskProposal;
  readonly admission: Admission;
}

export interface BatchReport {
  readonly admitted: readonly AdmittedTask[];
  readonly rejected: readonly AdmittedTask[];
  /** Proposals dropped because an identical task was already admitted this batch. */
  readonly duplicates: readonly AdmittedTask[];
  readonly admissionRate: number;
}

/**
 * Screen a batch of proposals, deduplicating by content hash.
 *
 * Deduplication is not housekeeping. An author agent asked for a hundred tasks will
 * happily emit the same task a hundred times; without this the dataset silently
 * reweights toward whatever the author finds easy to imagine.
 */
export function screenBatch(proposals: readonly TaskProposal[]): BatchReport {
  const admitted: AdmittedTask[] = [];
  const rejected: AdmittedTask[] = [];
  const duplicates: AdmittedTask[] = [];
  const seen = new Set<string>();

  for (const proposal of proposals) {
    const admission = admitTask(proposal);
    const entry = { proposal, admission };

    if (!admission.admitted) {
      rejected.push(entry);
      continue;
    }
    if (seen.has(admission.contentHash)) {
      duplicates.push(entry);
      continue;
    }
    seen.add(admission.contentHash);
    admitted.push(entry);
  }

  const total = proposals.length;
  return {
    admitted,
    rejected,
    duplicates,
    admissionRate: total === 0 ? 0 : admitted.length / total,
  };
}

/** Render rejections as author-facing feedback for the next authoring round. */
export function feedbackFor(admission: Admission): string {
  if (admission.admitted) return "admitted";
  return admission.rejections.map((r) => `[${r.code}] ${r.message}`).join("\n");
}

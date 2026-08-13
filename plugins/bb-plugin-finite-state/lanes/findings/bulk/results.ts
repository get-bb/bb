import type { VexBulkSetResult } from "../../../lib/remote/types.js";
import type { VexBulkTarget } from "./chunk.js";

const MAX_ITEM_ERRORS = 20;

export interface VexApplyError {
  findingId?: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface VexApplyResult {
  stableKey: string;
  targets: number;
  succeeded: number;
  failed: number;
  state: "applied" | "partial" | "failed" | "noop" | "stale" | "orphaned";
  errors: VexApplyError[];
}

type TargetState = "pending" | "cached-noop" | "noop" | "provisional" | "succeeded" | "failed";

export class VexItemAccumulator {
  readonly #states = new Map<string, TargetState>();
  readonly #errors: VexApplyError[] = [];
  #errorCount = 0;
  #allErrorsRetryable = true;
  #terminal: "stale" | "orphaned" | null = null;

  constructor(readonly stableKey: string, findingIds: readonly string[]) {
    for (const findingId of findingIds) {
      if (this.#states.has(findingId)) throw new Error(`Duplicate resolved VEX target ${findingId}`);
      this.#states.set(findingId, "pending");
    }
  }

  get terminal(): "stale" | "orphaned" | null {
    return this.#terminal;
  }

  get hasErrors(): boolean {
    return this.#errorCount > 0;
  }

  state(findingId: string): TargetState | undefined {
    return this.#states.get(findingId);
  }

  setTerminal(state: "stale" | "orphaned", error: VexApplyError): void {
    this.#terminal = state;
    this.addError(error);
    for (const [findingId, current] of this.#states) {
      if (current === "pending") this.#states.set(findingId, "failed");
    }
  }

  markNoop(findingId: string): void {
    this.#states.set(findingId, "noop");
  }

  markCachedNoop(findingId: string): void {
    this.#states.set(findingId, "cached-noop");
  }

  markProvisional(findingId: string): void {
    this.#states.set(findingId, "provisional");
  }

  markVerified(findingId: string): void {
    this.#states.set(findingId, this.#states.get(findingId) === "cached-noop" ? "noop" : "succeeded");
  }

  markFailed(findingId: string, error: VexApplyError): void {
    this.#states.set(findingId, "failed");
    this.addError({ ...error, findingId });
  }

  addError(error: VexApplyError): void {
    this.#errorCount += 1;
    this.#allErrorsRetryable &&= error.retryable;
    if (this.#errors.length < MAX_ITEM_ERRORS) this.#errors.push(error);
  }

  boundedErrors(): VexApplyError[] {
    if (this.#errorCount <= MAX_ITEM_ERRORS) return [...this.#errors];
    return [
      ...this.#errors.slice(0, MAX_ITEM_ERRORS - 1),
      {
        code: "VEX_ERRORS_TRUNCATED",
        message: `${this.#errorCount - (MAX_ITEM_ERRORS - 1)} additional target errors omitted`,
        retryable: this.#allErrorsRetryable,
      },
    ];
  }

  failItem(error: VexApplyError): void {
    this.addError(error);
    for (const [findingId, current] of this.#states) {
      if (current === "pending") this.#states.set(findingId, "failed");
    }
  }

  pendingTargets(): string[] {
    return [...this.#states].filter(([, state]) => state === "pending").map(([findingId]) => findingId);
  }

  verificationTargets(): string[] {
    return [...this.#states]
      .filter(([, state]) => state === "provisional" || state === "cached-noop")
      .map(([findingId]) => findingId);
  }

  result(): VexApplyResult {
    if (this.#terminal !== null) {
      return {
        stableKey: this.stableKey,
        targets: this.#states.size,
        succeeded: 0,
        failed: this.#states.size,
        state: this.#terminal,
        errors: this.boundedErrors(),
      };
    }
    const states = [...this.#states.values()];
    if (states.length === 0 && this.#errors.length > 0) {
      return {
        stableKey: this.stableKey,
        targets: 0,
        succeeded: 0,
        failed: 0,
        state: "failed",
        errors: this.boundedErrors(),
      };
    }
    const succeeded = states.filter((state) => state === "noop" || state === "succeeded").length;
    const failed = states.length - succeeded;
    const wrote = states.some((state) => state === "succeeded");
    return {
      stableKey: this.stableKey,
      targets: states.length,
      succeeded,
      failed,
      state: failed === 0 ? (wrote ? "applied" : "noop") : succeeded > 0 ? "partial" : "failed",
      errors: this.boundedErrors(),
    };
  }
}

export type SetEnvelopeOutcome =
  | { ok: true; succeeded: ReadonlySet<string>; failed: ReadonlyMap<string, string> }
  | { ok: false; code: "VEX_RESULT_INVALID"; message: string };

/** Re-validates the per-row envelope at the lane boundary and fails closed. */
export function consumeSetEnvelope(
  targets: readonly VexBulkTarget[],
  response: VexBulkSetResult,
): SetEnvelopeOutcome {
  const expected = new Map(targets.map((target) => [target.findingId, target]));
  const seen = new Set<string>();
  const succeeded = new Set<string>();
  const failed = new Map<string, string>();
  const summary = response.summary;
  const statusMatchesSummary = response.status === "success"
    ? summary.failed === 0
    : response.status === "failure"
      ? summary.succeeded === 0
      : summary.succeeded > 0 && summary.failed > 0;
  if (
    response.results.length !== targets.length
    || !Number.isSafeInteger(summary.total)
    || !Number.isSafeInteger(summary.succeeded)
    || !Number.isSafeInteger(summary.failed)
    || summary.total < 0
    || summary.succeeded < 0
    || summary.failed < 0
    || summary.total !== targets.length
    || summary.succeeded + summary.failed !== summary.total
    || !statusMatchesSummary
  ) {
    return { ok: false, code: "VEX_RESULT_INVALID", message: "Platform returned an incomplete VEX bulk envelope" };
  }
  for (const result of response.results) {
    const target = expected.get(result.findingId);
    if (target === undefined || seen.has(result.findingId)) {
      return { ok: false, code: "VEX_RESULT_INVALID", message: "Platform returned an unknown or duplicate VEX result id" };
    }
    seen.add(result.findingId);
    if (result.success) {
      if (target.action !== "set" || target.tuple?.status !== result.status) {
        return { ok: false, code: "VEX_RESULT_INVALID", message: "Platform reported a mismatched VEX success status" };
      }
      succeeded.add(result.findingId);
    } else {
      failed.set(result.findingId, result.error?.trim() || "Platform rejected the VEX decision");
    }
  }
  if (seen.size !== expected.size || succeeded.size !== summary.succeeded || failed.size !== summary.failed) {
    return { ok: false, code: "VEX_RESULT_INVALID", message: "Platform VEX summary did not match its per-row results" };
  }
  return { ok: true, succeeded, failed };
}

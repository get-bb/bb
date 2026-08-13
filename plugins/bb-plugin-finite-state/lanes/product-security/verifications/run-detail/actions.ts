import type { AssuranceStudioClient } from "../../../../lib/remote/types.js";
import type { VerificationTier } from "../matrix/status.js";

export interface VerificationRunRequest { requirementId: string; tier?: VerificationTier; checkId?: string }
export interface VerificationJob { jobId: string; state: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT"; progress?: number }
export interface ActionDeps {
  projectId: string;
  client: Pick<AssuranceStudioClient, "runVerificationChecks">;
  publish?(job: VerificationJob): void;
  readJob?(jobId: string, invokedAt: string): Promise<VerificationJob["state"] | null>;
  now?(): Date;
  sleep?(milliseconds: number): Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
}

export async function* runVerification(deps: ActionDeps, request: VerificationRunRequest): AsyncIterable<VerificationJob> {
  if (!request.checkId) throw new Error("CHECK_REQUIRED: a mapped verification check must be selected");
  const invokedAt = (deps.now?.() ?? new Date()).toISOString();
  const response = await deps.client.runVerificationChecks({ projectId: deps.projectId, checkIds: [request.checkId], rerunPassed: true });
  const queued: VerificationJob = { jobId: response.runId, state: "QUEUED", progress: 0 };
  deps.publish?.(queued);
  yield queued;
  const immediate = response.status.toUpperCase();
  let state: VerificationJob["state"] | null = immediate === "COMPLETED" || immediate === "FAILED" || immediate === "TIMEOUT" ? immediate : null;
  const sleep = deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (let poll = 0; state === null && poll < (deps.maxPolls ?? 60); poll += 1) {
    await sleep(deps.pollIntervalMs ?? 500);
    state = await deps.readJob?.(response.runId, invokedAt) ?? null;
    if (state === "QUEUED" || state === "RUNNING") {
      const update: VerificationJob = { jobId: response.runId, state, progress: Math.min(0.95, (poll + 1) / (deps.maxPolls ?? 60)) };
      deps.publish?.(update); yield update; state = null;
    }
  }
  const terminal: VerificationJob = { jobId: response.runId, state: state ?? "TIMEOUT", progress: 1 };
  deps.publish?.(terminal);
  yield terminal;
}

export function manualAttestationUnavailable(): never {
  throw new Error("VERIFICATION_RESULT_WRITE_UNAVAILABLE: owner ruling pending for AMD-0004 viability");
}

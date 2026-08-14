import type {
  CascadeDeps,
  ReproRequest,
  ReproSymptom,
  TierVerdict,
} from "./types.js";
import { CascadeError } from "./types.js";
import { validateVerdict } from "./escalation.js";

function symptomNeedle(symptom: ReproSymptom): string {
  switch (symptom.kind) {
    case "boot_hang":
      return symptom.marker;
    case "crash_signature":
      return symptom.signature;
    case "log_pattern":
      return symptom.pattern;
  }
}

function symptomMatched(output: string, symptom: ReproSymptom): boolean {
  const needle = symptomNeedle(symptom);
  if (needle.length === 0) return false;
  switch (symptom.kind) {
    case "boot_hang":
      return !output.includes(needle);
    case "crash_signature":
    case "log_pattern":
      return output.includes(needle);
  }
}

export async function runD1(
  deps: CascadeDeps,
  request: ReproRequest,
  signal: AbortSignal,
): Promise<TierVerdict> {
  signal.throwIfAborted();
  // This is WP-53's complete preflight/dispatch path. Errors propagate before
  // any cascade-specific observation is attempted.
  const started = await deps.runBench(request.bench, signal);
  const terminal = await deps.waitForRehostingTerminal(started.runId, signal);
  if (terminal.state === "running") {
    throw new CascadeError(
      "D1_RUN_IN_FLIGHT",
      "The rehosting run is still in flight; no diagnostic verdict was produced.",
    );
  }
  const observation = await deps.readRehostingObservation(
    started.runId,
    signal,
  );
  if (observation.command.length === 0) {
    throw new Error("D1_PROVENANCE_MISSING");
  }
  const emulationFailed = terminal.state === "failed";
  const outcome: TierVerdict["outcome"] = emulationFailed
    ? "inconclusive"
    : symptomMatched(observation.output, request.symptom)
      ? "confirmed"
      : "refuted";

  const verdict: TierVerdict = {
    tier: "d1",
    hypothesisId: request.hypothesis.id,
    outcome,
    forcedEscalation: false,
    evidence: [...observation.evidence],
    producedBy: {
      command: [...observation.command],
      inputs: {
        projectId: request.bench.projectId,
        projectVersionId: request.bench.pvId,
        hostId: request.bench.hostId,
        rehostingRunId: started.runId,
        symptomKind: request.symptom.kind,
        symptom: symptomNeedle(request.symptom),
      },
    },
    rehostingRunId: started.runId,
    ...(emulationFailed
      ? {
          annotations: [
            {
              code: "EMULATION_FAILED" as const,
              message:
                terminal.failureReason ??
                "The rehosting run did not complete, so the symptom was not tested conclusively.",
            },
          ],
        }
      : {}),
  };
  return validateVerdict(verdict, request.hypothesis);
}

export const runD1Rehosted = runD1;

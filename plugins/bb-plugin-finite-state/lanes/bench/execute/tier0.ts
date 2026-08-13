import type { BenchArtifactInput, BenchResultInput } from "../store/types.js";

export interface Tier0CheckContext {
  projectId: string;
  pvId: string;
  firmwareDigest: string;
  hostId: string;
  target: string | null;
  requirementId: string | null;
}

export interface Tier0CheckResult {
  checkId: string;
  requirementId?: string;
  outcome: "pass" | "fail" | "error" | "skipped";
  summary: string | null;
  partial?: boolean;
  artifacts?: BenchArtifactInput[];
}

export interface Tier0Analyzer {
  id: string;
  run(context: Tier0CheckContext, signal: AbortSignal): Promise<Tier0CheckResult>;
}

export interface Tier0Evidence {
  results: BenchResultInput[];
  artifacts: BenchArtifactInput[];
}

function errorResult(
  analyzer: Tier0Analyzer,
  context: Tier0CheckContext,
  message: string,
): BenchResultInput {
  return {
    requirementId: context.requirementId ?? `unmapped:${analyzer.id}`,
    checkId: analyzer.id,
    outcome: "error",
    evidenceSummary: message,
  };
}

export async function runTier0(
  analyzers: readonly Tier0Analyzer[],
  context: Tier0CheckContext,
  signal: AbortSignal,
): Promise<Tier0Evidence> {
  if (analyzers.length === 0) throw new Error("TIER0_ANALYZERS_UNAVAILABLE");
  const results: BenchResultInput[] = [];
  const artifacts: BenchArtifactInput[] = [];
  for (const analyzer of analyzers) {
    signal.throwIfAborted();
    try {
      const result = await analyzer.run(context, signal);
      if (!result.checkId) throw new Error(`Analyzer ${analyzer.id} returned an empty check id`);
      results.push({
        requirementId:
          result.requirementId ?? context.requirementId ?? `unmapped:${result.checkId}`,
        checkId: result.checkId,
        outcome: result.partial && result.outcome === "pass" ? "error" : result.outcome,
        evidenceSummary: result.partial
          ? [result.summary, "Analyzer returned partial evidence."].filter(Boolean).join(" ")
          : result.summary,
      });
      artifacts.push(...(result.artifacts ?? []));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analyzer failed with a non-Error value";
      results.push(errorResult(analyzer, context, message));
    }
  }
  return { results, artifacts };
}


import type {
  BenchResultOutcome,
  BenchRunStatus,
  BenchTier,
  MatrixTier,
} from "./types.js";

function assertNever(value: never): never {
  throw new Error(`Unhandled bench value: ${String(value)}`);
}

export function matrixTierForBenchTier(tier: BenchTier): MatrixTier {
  switch (tier) {
    case "tier0":
      return "static";
    case "tier1":
    case "tier2":
      return "emulation";
    case "tier3":
      return "hil";
    case "tier4":
      return "manual";
    default:
      return assertNever(tier);
  }
}

export function mapUpstreamRunStatus(status: string): BenchRunStatus {
  switch (status) {
    case "RUNNING":
      return "running";
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "failed";
    case "TIMEOUT":
      return "timeout";
    default:
      throw new Error(`Unknown upstream bench status: ${status}`);
  }
}

export function mapUpstreamRunState<Raw>(
  status: string,
  raw: Raw,
): { status: BenchRunStatus; raw: Raw } {
  return { status: mapUpstreamRunStatus(status), raw };
}

export function resultStatusForOutcome(
  outcome: BenchResultOutcome,
): "verified" | "failed" | "error" | "skipped" {
  switch (outcome) {
    case "pass":
      return "verified";
    case "fail":
      return "failed";
    case "error":
      return "error";
    case "skipped":
      return "skipped";
    default:
      return assertNever(outcome);
  }
}

import {
  BenchRunError,
  runBench,
  type BenchExecutionDeps,
  type BenchRunRequest,
  type BenchRunStarted,
} from "./run.js";

export type BenchRunAttempt =
  | { success: true; run: BenchRunStarted }
  | {
      success: false;
      runId: string;
      code: string;
      message: string;
    };

/**
 * Starts one bench attempt and preserves the durable identity of an expected
 * post-mint failure. Registered surfaces adapt this result to their frozen
 * output contracts instead of independently dispatching the run.
 */
export async function startBenchRunAttempt(
  deps: BenchExecutionDeps,
  request: BenchRunRequest,
  signal: AbortSignal,
): Promise<BenchRunAttempt> {
  try {
    return { success: true, run: await runBench(deps, request, signal) };
  } catch (error) {
    if (error instanceof BenchRunError && error.runId !== null) {
      return {
        success: false,
        runId: error.runId,
        code: error.code,
        message: error.message,
      };
    }
    throw error;
  }
}

import { stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resourceUsage } from "node:process";

export interface QueryDiagnosticsLogFields {
  resourceUsage: {
    minorPageFault: number;
    majorPageFault: number;
    fsRead: number;
    fsWrite: number;
    voluntaryContextSwitches: number;
    involuntaryContextSwitches: number;
  };
  wal: {
    sizeBytes: number | null;
    sampledAt: string | null;
  };
}

export function createWalSampler(
  walPath: string | null,
): () => QueryDiagnosticsLogFields["wal"] {
  let sample: QueryDiagnosticsLogFields["wal"] = {
    sizeBytes: null,
    sampledAt: null,
  };
  let nextSampleAt = 0;
  let pending = false;
  return () => {
    if (walPath !== null && !pending && performance.now() >= nextSampleAt) {
      pending = true;
      void stat(walPath)
        .then(
          (details) => {
            sample = {
              sizeBytes: details.size,
              sampledAt: new Date().toISOString(),
            };
          },
          () => {
            sample = { sizeBytes: null, sampledAt: new Date().toISOString() };
          },
        )
        .finally(() => {
          nextSampleAt = performance.now() + 1_000;
          pending = false;
        });
    }
    return sample;
  };
}

export function finishQueryDiagnostics(
  startedUsage: ReturnType<typeof resourceUsage>,
  finishedUsage: ReturnType<typeof resourceUsage>,
  wal: QueryDiagnosticsLogFields["wal"],
): QueryDiagnosticsLogFields {
  return {
    resourceUsage: {
      minorPageFault:
        finishedUsage.minorPageFault - startedUsage.minorPageFault,
      majorPageFault:
        finishedUsage.majorPageFault - startedUsage.majorPageFault,
      fsRead: finishedUsage.fsRead - startedUsage.fsRead,
      fsWrite: finishedUsage.fsWrite - startedUsage.fsWrite,
      voluntaryContextSwitches:
        finishedUsage.voluntaryContextSwitches -
        startedUsage.voluntaryContextSwitches,
      involuntaryContextSwitches:
        finishedUsage.involuntaryContextSwitches -
        startedUsage.involuntaryContextSwitches,
    },
    wal,
  };
}

import { statSync } from "node:fs";
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
  };
}

export function finishQueryDiagnostics(
  startedUsage: ReturnType<typeof resourceUsage>,
  finishedUsage: ReturnType<typeof resourceUsage>,
  walPath: string | null,
): QueryDiagnosticsLogFields {
  let sizeBytes: number | null = null;
  if (walPath !== null) {
    try {
      sizeBytes = statSync(walPath).size;
    } catch {}
  }
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
    wal: { sizeBytes },
  };
}

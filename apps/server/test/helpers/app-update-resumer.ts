import type {
  AppUpdateInterruptResult,
  AppUpdateResumer,
} from "../../src/services/system/app-update-resume.js";

export interface FakeAppUpdateResumer extends AppUpdateResumer {
  calls: string[];
}

export function createFakeAppUpdateResumer(
  result: AppUpdateInterruptResult = {
    idleThreadsWithJobs: [],
    threads: [],
    waitMs: 0,
  },
): FakeAppUpdateResumer {
  const calls: string[] = [];
  return {
    calls,
    async interrupt() {
      calls.push("interrupt");
      return result;
    },
    async parkResumes() {
      calls.push("park");
    },
    releaseResumes() {
      calls.push("release");
      return 0;
    },
    resumedThreadCount: () => 0,
  };
}

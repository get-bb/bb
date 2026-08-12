import type {
  ForgeJobSnapshot,
  ForgeJobStatus,
} from "../../../lib/remote/types.js";
import { listMockForgeJobs, watchMockForgeJob } from "./jobs.js";
import {
  createMockForgeComputeController,
  type ForgeComputeController,
  type MockForgeComputeClock,
} from "./state.js";

export interface MockForgeComputeService {
  readonly configured: boolean;
  readonly controller: ForgeComputeController;
  prepare(input: { projectVersionId: string; rootPath: string; expectedDigest: string }):
    { prepared: false; reason: "UNSUPPORTED_UNVERIFIED_MAPPING" };
  verifyDynamic(input: unknown): { jobId: string };
  penTestRun(input: unknown): { jobId: string };
  getJobStatus(jobId: string, tailLines?: number): ForgeJobSnapshot;
  listJobs(input?: { status?: ForgeJobStatus; tool?: string }): ForgeJobSnapshot[];
  watchJob(jobId: string): ForgeJobSnapshot;
  reset(): void;
}

export function registerMockForgeCompute(
  fixtureRoot: string,
  options: { configured?: boolean; clock?: MockForgeComputeClock } = {},
): MockForgeComputeService | null {
  if (options.configured === false) return null;
  const controller = createMockForgeComputeController(fixtureRoot, options);
  return {
    configured: true,
    controller,
    prepare: (input) => controller.prepare(input),
    verifyDynamic: (input) => controller.create("verifyDynamic", input),
    penTestRun: (input) => controller.create("penTestRun", input),
    getJobStatus: (jobId, tailLines = 50) => controller.get(jobId, tailLines),
    listJobs: (input) => listMockForgeJobs(controller, input),
    watchJob: (jobId) => watchMockForgeJob(controller, jobId),
    reset: () => controller.reset(),
  };
}

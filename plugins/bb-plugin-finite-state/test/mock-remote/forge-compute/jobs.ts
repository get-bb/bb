import type {
  ForgeJobSnapshot,
  ForgeJobStatus,
} from "../../../lib/remote/types.js";
import type { ForgeComputeController } from "./state.js";

export function listMockForgeJobs(
  controller: ForgeComputeController,
  input: { status?: ForgeJobStatus; tool?: string } = {},
): ForgeJobSnapshot[] {
  return controller.list().filter((job) =>
    (input.status === undefined || job.status === input.status) &&
    (input.tool === undefined || job.tool === input.tool),
  );
}

/** One deterministic observation per controller state; callers advance explicitly. */
export function watchMockForgeJob(
  controller: ForgeComputeController,
  jobId: string,
  tailLines = 50,
): ForgeJobSnapshot {
  return controller.get(jobId, tailLines);
}

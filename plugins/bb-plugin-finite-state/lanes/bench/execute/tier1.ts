import type { Json } from "../../../lib/remote/types.js";
import type {
  ForgeComputeClient,
  ForgeDeploymentContext,
} from "../../../lib/remote/types.js";
import {
  startForgeWithPreparedFirmware,
  type FirmwareHandshakeDeps,
  type ForgeProcessAdapter,
  type PreparedFirmware,
} from "../../firmware/forge/handshake.js";

export interface Tier1Targets {
  verdictIds: string[];
  cveId: string;
  componentId: string;
  findingId: string | null;
}

export interface Tier1DispatchDeps {
  forgeCompute: Pick<ForgeComputeClient, "verifyDynamic" | "penTestRun">;
  firmwareHandshake: FirmwareHandshakeDeps;
  forgeProcess: ForgeProcessAdapter;
}

function jobIdFromVerifyDynamic(value: Json): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("FORGE_VERIFY_DYNAMIC_INVALID_JOB");
  }
  const jobId = value.job_id ?? value.jobId;
  if (typeof jobId !== "string" || jobId.length === 0) {
    throw new Error("FORGE_VERIFY_DYNAMIC_INVALID_JOB");
  }
  return jobId;
}

export function validateDeploymentContext(
  context: ForgeDeploymentContext | undefined,
): ForgeDeploymentContext {
  if (!context) throw new Error("DEPLOYMENT_CONTEXT_REQUIRED");
  const fields = [
    "productType",
    "networkExposure",
    "regulatory",
    "deploymentNotes",
    "rootComponentName",
    "rootComponentType",
  ] as const;
  for (const name of fields) {
    const value = context[name];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`DEPLOYMENT_CONTEXT_INVALID: ${name}`);
    }
  }
  return context;
}

export async function dispatchTier1(
  deps: Tier1DispatchDeps,
  input: {
    projectId: string;
    pvId: string;
    prepared: PreparedFirmware;
    targets: Tier1Targets;
    deploymentContext: ForgeDeploymentContext;
  },
  signal: AbortSignal,
): Promise<string[]> {
  signal.throwIfAborted();
  if (input.targets.verdictIds.length === 0) throw new Error("TIER1_VERDICT_TARGET_REQUIRED");
  const deploymentContext = validateDeploymentContext(input.deploymentContext);

  // This reads the sealed object's non-enumerable environment directly and
  // revalidates the exact prepared bytes before the Forge process can start.
  await startForgeWithPreparedFirmware(
    deps.firmwareHandshake,
    deps.forgeProcess,
    input.prepared,
    signal,
  );

  const dynamic = await deps.forgeCompute.verifyDynamic(
    { projectVersionId: input.pvId, verdictIds: input.targets.verdictIds },
    { signal },
  );
  const dynamicJobId = jobIdFromVerifyDynamic(dynamic);
  const pentest = await deps.forgeCompute.penTestRun(
    {
      cveId: input.targets.cveId,
      componentId: input.targets.componentId,
      projectId: input.projectId,
      projectVersionId: input.pvId,
      findingId: input.targets.findingId,
      deploymentContext,
    },
    { signal },
  );
  if (!pentest.jobId) throw new Error("FORGE_PENTEST_INVALID_JOB");
  return [dynamicJobId, pentest.jobId];
}

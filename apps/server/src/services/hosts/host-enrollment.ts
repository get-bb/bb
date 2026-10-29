import {
  beginMachineEnrollment,
  recordMachineSetupResult,
} from "../system/device-telemetry.js";
import { createHostId } from "@bb/db";
import type { AppDeps } from "../../types.js";

type HostEnrollmentDeps = Pick<
  AppDeps,
  "db" | "machineAuth" | "config" | "telemetry"
>;

interface IssueHostEnrollKeyArgs {
  enrollSource: "loopback" | "public-multi-machine";
  hostId?: string;
}

export async function issueHostEnrollKey(
  deps: HostEnrollmentDeps,
  args: IssueHostEnrollKeyArgs,
) {
  const hostId = args.hostId ?? createHostId();

  if (args.enrollSource === "public-multi-machine")
    beginMachineEnrollment(deps, hostId);
  const enrollKey = await deps.machineAuth
    .issueHostEnrollKey({
      enrollSource: args.enrollSource,
      hostId,
    })
    .catch((error: unknown) => {
      if (args.enrollSource === "public-multi-machine")
        recordMachineSetupResult(deps, hostId, "unknown");
      throw error;
    });

  return { enrollKey, hostId };
}

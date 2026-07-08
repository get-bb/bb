import { getAppSettings } from "@bb/db";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps } from "../../types.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { resolvePrimaryHostId } from "../hosts/primary-host.js";

type CaffeinateSettingsDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "machineAuth"
  | "telemetry"
>;

export interface SchedulePrimaryHostCaffeinateReconciliationArgs {
  reason: "daemon-open" | "settings-updated";
}

async function reconcilePrimaryHostCaffeinateSetting(
  deps: CaffeinateSettingsDeps,
): Promise<void> {
  const hostId = resolvePrimaryHostId(deps);
  if (hostId === null || !deps.hub.hasDaemonForHost(hostId)) {
    return;
  }

  const settings = getAppSettings(deps.db);
  await callHostOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.caffeinate",
      enabled: settings.caffeinate,
    },
  });
}

export function schedulePrimaryHostCaffeinateReconciliation(
  deps: CaffeinateSettingsDeps,
  args: SchedulePrimaryHostCaffeinateReconciliationArgs,
): void {
  void reconcilePrimaryHostCaffeinateSetting(deps).catch((error) => {
    deps.logger.warn(
      {
        reason: args.reason,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Failed to apply Caffeinate setting to host daemon",
    );
  });
}

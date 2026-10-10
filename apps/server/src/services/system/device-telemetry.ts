import { countActiveHostsExcept } from "@bb/db";
import type { AppDeps } from "../../types.js";
import { readPrimaryHostIdFromDataDir } from "../hosts/primary-host.js";

export function recordMachinePaired(
  deps: Pick<AppDeps, "config" | "db" | "logger" | "telemetry">,
  hostId: string,
): void {
  try {
    const serverHostId = readPrimaryHostIdFromDataDir({
      dataDir: deps.config.dataDir,
    });
    if (serverHostId === hostId) return;
    deps.telemetry.capture({
      name: "device_paired",
      properties: {
        device: "machine",
        first_of_kind: countActiveHostsExcept(deps.db, serverHostId) === 1,
      },
    });
  } catch (error) {
    deps.logger.debug({ err: error }, "Device telemetry failed");
  }
}

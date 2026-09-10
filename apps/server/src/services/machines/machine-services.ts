import type { DbConnection } from "@bb/db";
import type { AppDeps } from "../../types.js";
import { createMachineEnrollmentService } from "./enrollments.js";
import { serverAccess } from "./server-access.js";

export type MachineEnrollmentService = ReturnType<
  typeof createMachineEnrollmentService
>;

const services = new WeakMap<DbConnection, MachineEnrollmentService>();

export function getMachineEnrollmentService(
  deps: Pick<AppDeps, "db" | "machineAuth" | "hub" | "logger">,
): MachineEnrollmentService {
  let service = services.get(deps.db);
  if (!service) {
    service = createMachineEnrollmentService({
      db: deps.db,
      machineAuth: deps.machineAuth,
      serverAccess: {
        resolve: (request) => serverAccess.resolve(deps, request),
        release: (request) => serverAccess.release(deps, request),
      },
      isConnected: (hostId) => deps.hub.hasDaemonForHost(hostId),
    });
    services.set(deps.db, service);
  }
  return service;
}

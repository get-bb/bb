import type { LoggedWorkSessionDeps } from "../../types.js";
import { installHostConnectPrewarm } from "../hosts/host-connect-prewarm.js";
import { getProviderInstallations } from "./provider-installations.js";

export function installProviderCliStatusPrewarm(
  deps: LoggedWorkSessionDeps,
): { stop(): void } {
  return installHostConnectPrewarm(deps, {
    failureMessage: "Provider CLI status prewarm pass failed",
    async runPass({ hostId, isCurrent }) {
      const startedAt = Date.now();
      try {
        const statuses = await getProviderInstallations(deps, {
          hostId,
          mode: "prewarm",
        });
        deps.logger.info(
          {
            hostId,
            providerCount: Object.keys(statuses).length,
            durationMs: Date.now() - startedAt,
          },
          "Provider CLI status prewarm pass finished",
        );
      } catch (error) {
        if (isCurrent()) {
          throw error;
        }
      }
    },
  });
}

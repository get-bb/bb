import { getExperiments, type DbConnection } from "@bb/db";
import { startPerformanceDiagnostics } from "@bb/process-utils";
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";

export async function startGatedPerformanceDiagnostics(options: {
  allowed: boolean;
  dataDir: string;
  db: DbConnection;
  hub: NotificationHub;
  logger: Pick<ServerLogger, "info" | "warn">;
}): Promise<{ isEnabled: () => boolean; stop: () => Promise<void> }> {
  let enabled = false;
  let stopped = false;
  let recorder: Awaited<ReturnType<typeof startPerformanceDiagnostics>> | null =
    null;
  let pending = Promise.resolve();
  const refresh = (): Promise<void> => {
    enabled =
      !stopped &&
      options.allowed &&
      getExperiments(options.db).performanceDiagnostics;
    pending = pending
      .then(async () => {
        if (enabled && recorder === null) {
          recorder = await startPerformanceDiagnostics(options);
        }
        if (!enabled && recorder !== null) {
          await recorder.stop();
          recorder = null;
          options.logger.info({}, "Server performance diagnostics stopped");
        }
      })
      .catch((error: unknown) => {
        options.logger.warn(
          { err: error },
          "Could not update server performance diagnostics",
        );
      });
    return pending;
  };
  const unsubscribe = options.allowed
    ? options.hub.onChangedMessage((message) => {
        if (
          message.entity === "system" &&
          message.changes.includes("config-changed")
        )
          void refresh();
      })
    : () => {};
  await refresh();
  return {
    isEnabled: () => enabled,
    stop: () => {
      stopped = true;
      unsubscribe();
      return refresh();
    },
  };
}

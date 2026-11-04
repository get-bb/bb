import { getExperiments, setAppUpdateSendHold } from "@bb/db";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { requestQueuedMessageDispatch } from "../threads/queued-message-dispatch.js";

export interface AppUpdateSendHold {
  hold(): void;
  release(): void;
}

export function createAppUpdateSendHold(
  deps: LoggedPendingInteractionWorkSessionDeps,
): AppUpdateSendHold {
  return {
    hold() {
      if (!getExperiments(deps.db).updateWhenIdle) return;
      setAppUpdateSendHold(deps.db, true);
      deps.logger.info("Holding new sends until bb restarts to update");
    },
    release() {
      if (!setAppUpdateSendHold(deps.db, false)) return;
      deps.logger.info("Releasing the sends held for a bb update");
      requestQueuedMessageDispatch(deps, { kind: "app-update-released" });
    },
  };
}

export function releaseSendsHeldAcrossRestart(
  deps: LoggedPendingInteractionWorkSessionDeps,
): void {
  setAppUpdateSendHold(deps.db, false);
  requestQueuedMessageDispatch(deps, { kind: "app-update-released" });
}

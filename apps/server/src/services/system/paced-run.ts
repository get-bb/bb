import { listRunningThreads } from "@bb/db";
import type { AppDeps } from "../../types.js";
import { isServerMoveFrozen } from "../server-move/freeze-state.js";

const PACED_SLICE_MS = 10;
const PACED_RUN_BUDGET_MS = 30_000;
const BUSY_REST_FACTOR = 9;
const IDLE_REST_FACTOR = 1;
const STEP_COST_SMOOTHING = 0.2;

export interface PacedRun {
  mayContinue(): boolean;
  run(step: () => boolean | Promise<boolean>): Promise<boolean>;
}

export function startPacedRun(deps: Pick<AppDeps, "db" | "hub">): PacedRun {
  const startedAt = performance.now();
  const mayContinue = () =>
    performance.now() - startedAt < PACED_RUN_BUDGET_MS &&
    !isServerMoveFrozen(deps.db);
  let stepCostMs = 0;
  let resumeAt = 0;
  return {
    mayContinue,
    async run(step) {
      for (;;) {
        const restMs = resumeAt - performance.now();
        if (restMs > 0)
          await new Promise<void>((resolve) => setTimeout(resolve, restMs));
        if (!mayContinue()) return false;
        const sliceStartedAt = performance.now();
        let finished = false;
        do {
          const stepStartedAt = performance.now();
          finished = await step();
          stepCostMs +=
            STEP_COST_SMOOTHING *
            (performance.now() - stepStartedAt - stepCostMs);
        } while (
          !finished &&
          performance.now() - sliceStartedAt + stepCostMs <= PACED_SLICE_MS
        );
        const busy =
          deps.hub.hasClients() || listRunningThreads(deps.db).length > 0;
        const workedMs = performance.now() - sliceStartedAt;
        resumeAt =
          performance.now() +
          Math.max(1, workedMs * (busy ? BUSY_REST_FACTOR : IDLE_REST_FACTOR));
        if (finished) return true;
      }
    },
  };
}

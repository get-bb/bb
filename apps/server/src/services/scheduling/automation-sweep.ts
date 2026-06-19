import {
  claimAutomationScheduledRun,
  listDueAutomations,
  restoreAutomationAfterFailedRun,
  type AutomationRow,
  type AutomationRunRow,
} from "@bb/db";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { resolvePrimaryHostId } from "../hosts/primary-host.js";
import { parseAutomationDefinition } from "./automation-config.js";
import { executeAgentRun, executeScriptRun } from "./automation-run.js";
import { computeNextScheduledTime } from "./schedule-helpers.js";

const DUE_AUTOMATION_BATCH_SIZE = 100;

interface SweepDueAutomationsArgs {
  now?: number;
}

type AutomationSweepDeps = LoggedPendingInteractionWorkSessionDeps;

/** Roll the schedule back so the next tick retries this run. */
function buildScheduleRollback(
  deps: AutomationSweepDeps,
  args: {
    automation: AutomationRow;
    run: AutomationRunRow;
    advancedNextRunAt: number | null;
    now: number;
  },
): (error: unknown) => void {
  return (error) => {
    restoreAutomationAfterFailedRun(deps.db, {
      automationId: args.automation.id,
      runId: args.run.id,
      advancedNextRunAt: args.advancedNextRunAt,
      restoredNextRunAt: args.automation.nextRunAt ?? args.now,
      expectedRunCount: args.automation.runCount + 1,
      error: error instanceof Error ? error.message : String(error),
      now: args.now,
    });
  };
}

async function processDueAutomation(
  deps: AutomationSweepDeps,
  automation: AutomationRow,
  now: number,
): Promise<void> {
  if (automation.nextRunAt === null) {
    return;
  }
  const expectedNextRunAt = automation.nextRunAt;

  let definition: ReturnType<typeof parseAutomationDefinition>;
  let newNextRunAt: number;
  try {
    definition = parseAutomationDefinition(automation);
    newNextRunAt = computeNextScheduledTime({
      cron: definition.trigger.cron,
      now,
      timezone: definition.trigger.timezone,
    });
  } catch (error) {
    deps.logger.error(
      { automationId: automation.id, err: error },
      "Skipping due automation with invalid stored configuration",
    );
    return;
  }

  // Operator gate: when script runs are disabled, do not claim/advance a script
  // automation so it resumes cleanly if re-enabled (DEFAULT ENABLED, so this is
  // a no-op out of the box).
  if (
    definition.execution.mode === "script" &&
    !deps.config.automationsAllowScriptRuns
  ) {
    deps.logger.warn(
      { automationId: automation.id },
      "Skipping due script automation: script runs are disabled",
    );
    return;
  }

  const claim = claimAutomationScheduledRun(deps.db, {
    automationId: automation.id,
    expectedNextRunAt,
    newNextRunAt,
    now,
  });
  if (!claim.advanced) {
    return;
  }
  deps.hub.notifyProject(automation.projectId, [
    "automations-changed",
    "automation-runs-changed",
  ]);

  const onFailure = buildScheduleRollback(deps, {
    automation,
    run: claim.run,
    advancedNextRunAt: newNextRunAt,
    now,
  });

  if (definition.execution.mode === "agent") {
    await executeAgentRun(deps, {
      automation,
      run: claim.run,
      execution: definition.execution,
      environment: definition.environment,
      onFailure,
    });
  } else {
    await executeScriptRun(deps, {
      automation,
      run: claim.run,
      execution: definition.execution,
      environment: definition.environment,
      onFailure,
      now,
    });
  }
}

export async function sweepDueAutomations(
  deps: AutomationSweepDeps,
  args: SweepDueAutomationsArgs = {},
): Promise<void> {
  const now = args.now ?? Date.now();
  // No primary host means nothing can run; skip the sweep entirely.
  if (resolvePrimaryHostId(deps) === null) {
    return;
  }
  const dueAutomations = listDueAutomations(deps.db, {
    now,
    limit: DUE_AUTOMATION_BATCH_SIZE,
  });
  for (const automation of dueAutomations) {
    try {
      await processDueAutomation(deps, automation, now);
    } catch (error) {
      deps.logger.error(
        { automationId: automation.id, err: error },
        "Failed to process a due automation",
      );
    }
  }
}

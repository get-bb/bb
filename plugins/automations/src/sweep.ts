import type { BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";
import {
  claimAutomationScheduledRun,
  listDueAutomations,
  parseAutomationExecution,
  parseAutomationTrigger,
  restoreAutomationAfterFailedRun,
  type AutomationRow,
  type AutomationRunRow,
  type Db,
} from "./data.js";
import { publishAutomationChange } from "./realtime.js";
import { computeNextScheduledTime } from "./schedule-helpers.js";
import { executeAgentRun, executeScriptRun } from "./run.js";

const DUE_AUTOMATION_BATCH_SIZE = 100;
export const SWEEP_INTERVAL_MS = 10_000;

const hostListSchema = z.array(
  z.object({ status: z.enum(["connected", "disconnected"]) }).passthrough(),
);
type SweepApi = Pick<BbPluginApi, "realtime" | "log"> & {
  sdk: {
    hosts: { list(): Promise<unknown> };
    threads: {
      get(args: Parameters<BbPluginApi["sdk"]["threads"]["get"]>[0]): Promise<unknown>;
      send(args: Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0]): Promise<unknown>;
      spawn(
        args: Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0],
      ): Promise<unknown>;
    };
  };
};

function buildScheduleRollback(
  db: Db,
  args: {
    automation: AutomationRow;
    run: AutomationRunRow;
    advancedNextRunAt: number | null;
    now: number;
  },
): (error: unknown) => void {
  return (error) => {
    restoreAutomationAfterFailedRun(db, {
      automationId: args.automation.id,
      runId: args.run.id,
      triggerType: args.automation.triggerType,
      advancedNextRunAt: args.advancedNextRunAt,
      restoredNextRunAt: args.automation.nextRunAt ?? args.now,
      expectedRunCount: args.automation.runCount + 1,
      error: error instanceof Error ? error.message : String(error),
      now: args.now,
    });
  };
}

async function processDueAutomation(
  bb: SweepApi,
  db: Db,
  args: {
    pluginDataDir: string;
    automation: AutomationRow;
    now: number;
    allowScriptRuns: boolean;
    agentHostsAvailable: boolean;
    serverUrl: string;
  },
): Promise<void> {
  if (args.automation.nextRunAt === null) return;
  const expectedNextRunAt = args.automation.nextRunAt;
  let newNextRunAt: number | null;
  let execution;
  try {
    const trigger = parseAutomationTrigger(args.automation.triggerConfig);
    execution = parseAutomationExecution(args.automation.execution);
    newNextRunAt =
      trigger.triggerType === "once"
        ? null
        : computeNextScheduledTime({
            cron: trigger.cron,
            now: args.now,
            timezone: trigger.timezone,
          });
  } catch (error) {
    bb.log.error(
      `Skipping due automation ${args.automation.id} with invalid stored configuration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }

  if (execution.mode === "agent" && !args.agentHostsAvailable) {
    return;
  }

  if (execution.mode === "script" && !args.allowScriptRuns) {
    bb.log.warn(
      `Skipping due script automation ${args.automation.id}: script runs are disabled`,
    );
    return;
  }

  const claim = claimAutomationScheduledRun(db, {
    automationId: args.automation.id,
    expectedNextRunAt,
    newNextRunAt,
    now: args.now,
  });
  if (!claim.advanced) return;
  publishAutomationChange(bb, args.automation.projectId, [
    "automations-changed",
    "automation-runs-changed",
  ]);
  const onFailure = buildScheduleRollback(db, {
    automation: args.automation,
    run: claim.run,
    advancedNextRunAt: newNextRunAt,
    now: args.now,
  });
  if (execution.mode === "agent") {
    await executeAgentRun(bb, db, {
      automation: args.automation,
      run: claim.run,
      execution,
      onFailure,
    });
  } else {
    void executeScriptRun(bb, db, {
      pluginDataDir: args.pluginDataDir,
      automation: args.automation,
      run: claim.run,
      execution,
      onFailure,
      serverUrl: args.serverUrl,
    }).catch((error: unknown) => {
      bb.log.error(
        `Detached script automation ${args.automation.id} failed unexpectedly: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}

async function hasConnectedHost(
  bb: Pick<BbPluginApi, "log"> & {
    sdk: { hosts: { list(): Promise<unknown> } };
  },
): Promise<boolean> {
  try {
    return hostListSchema
      .parse(await bb.sdk.hosts.list())
      .some((host) => host.status === "connected");
  } catch (error) {
    bb.log.warn(
      `Failed to list hosts for automation sweep: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

export async function sweepDueAutomations(
  bb: SweepApi,
  db: Db,
  args: {
    pluginDataDir: string;
    allowScriptRuns: boolean;
    serverUrl: string;
    now?: number;
  },
): Promise<void> {
  const now = args.now ?? Date.now();
  const due = listDueAutomations(db, { now, limit: DUE_AUTOMATION_BATCH_SIZE });
  const agentHostsAvailable = await hasConnectedHost(bb);
  for (const automation of due) {
    try {
      await processDueAutomation(bb, db, {
        pluginDataDir: args.pluginDataDir,
        automation,
        now,
        allowScriptRuns: args.allowScriptRuns,
        agentHostsAvailable,
        serverUrl: args.serverUrl,
      });
    } catch (error) {
      bb.log.error(
        `Failed to process due automation ${automation.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

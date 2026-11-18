import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { listRunningAutomationRuns, migrations } from "./data.js";
import { ingestLegacyImport } from "./legacy-import.js";
import { pluginDataDirFromDb } from "./path.js";
import { automationRpcContract, createRpcHandlers } from "./rpc.js";
import {
  errorMessage,
  reconcileRunningAutomationRuns,
  settleAutomationRunsForThread,
} from "./run.js";
import { registerAutomationCli } from "./cli.js";
import { createScriptRunScope } from "./script-runner.js";
import { createAutomationService } from "./service.js";
import { sleep, sweepDueAutomations, SWEEP_INTERVAL_MS } from "./sweep.js";

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  const pluginDataDir = pluginDataDirFromDb(db);
  await ingestLegacyImport({ bb, db, pluginDataDir });
  const scriptRuns = createScriptRunScope();
  bb.onDispose(() => scriptRuns.stop());

  const service = createAutomationService({
    bb,
    db,
    pluginDataDir,
    scriptRuns,
  });

  bb.rpc.register(automationRpcContract, createRpcHandlers(service));
  registerAutomationCli({ bb, service });

  bb.events.on("experimental_thread.settled", (event) => {
    settleAutomationRunsForThread(bb, db, event);
  });

  bb.background.service("automation-sweep", {
    async start(signal) {
      let uncheckedRuns: ReadonlySet<string> = new Set(
        listRunningAutomationRuns(db).map((run) => run.id),
      );
      let serverHostId: string | null = null;
      while (!signal.aborted) {
        try {
          if (uncheckedRuns.size > 0) {
            uncheckedRuns = await reconcileRunningAutomationRuns(
              bb,
              db,
              uncheckedRuns,
            );
          }
          serverHostId ??= (await bb.sdk.system.config()).primaryHostId;
          await sweepDueAutomations(bb, db, {
            pluginDataDir,
            serverHostId,
            scriptRuns,
          });
        } catch (error) {
          bb.log.error(`Automation sweep failed: ${errorMessage(error)}`);
        }
        await sleep(SWEEP_INTERVAL_MS, signal);
      }
    },
  });
}

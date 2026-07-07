import type { BbPluginApi } from "@bb/plugin-sdk";
import { migrations } from "./data.js";
import { ingestLegacyImport } from "./legacy-import.js";
import { pluginDataDirFromDb } from "./path.js";
import { createRpcHandlers } from "./rpc.js";
import { closeAutomationRunForSettledThread, disableAutomationsForDeletedThreadEvent } from "./run.js";
import { registerAutomationCli } from "./cli.js";
import { createAutomationService } from "./service.js";
import { sleep, sweepDueAutomations, SWEEP_INTERVAL_MS } from "./sweep.js";

function resolveServerUrl(): string {
  return process.env.BB_SERVER_URL?.trim() || "http://127.0.0.1:38886";
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    allowScriptRuns: {
      type: "boolean",
      label: "Allow script automations",
      description: "Allow automations to run stored bash/sh/node/python3 scripts on the server.",
      default: true,
    },
  });

  const db = bb.storage.sqlite();
  bb.storage.migrate(db, migrations);
  const pluginDataDir = pluginDataDirFromDb(db);
  await ingestLegacyImport({ bb, db, pluginDataDir });

  let allowScriptRuns = (await settings.get()).allowScriptRuns;
  settings.onChange((next) => {
    allowScriptRuns = next.allowScriptRuns;
  });

  const getAllowScriptRuns = async (): Promise<boolean> => allowScriptRuns;

  const service = createAutomationService({
    bb,
    db,
    pluginDataDir,
    getAllowScriptRuns,
    serverUrl: resolveServerUrl(),
  });

  bb.rpc.register(createRpcHandlers(service));
  registerAutomationCli({ bb, service });

  bb.on("thread.idle", ({ thread }) => {
    closeAutomationRunForSettledThread(bb, db, {
      threadId: thread.id,
      status: "idle",
    });
  });
  bb.on("thread.failed", ({ thread, error }) => {
    closeAutomationRunForSettledThread(bb, db, {
      threadId: thread.id,
      status: "failed",
      error,
    });
  });

  bb.on("thread.deleted", ({ thread }) => {
    disableAutomationsForDeletedThreadEvent(bb, db, thread.id);
  });

  bb.background.service("automation-sweep", {
    async start(signal) {
      while (!signal.aborted) {
        try {
          await sweepDueAutomations(bb, db, {
            pluginDataDir,
            allowScriptRuns,
            serverUrl: resolveServerUrl(),
          });
        } catch (error) {
          bb.log.error(
            `Automation sweep failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        await sleep(SWEEP_INTERVAL_MS, signal);
      }
    },
  });
}

import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

import { createStore, registerTasksApi } from "./api";
import { registerAttachments } from "./attachments";

export const TASKS_PLUGIN_NAME = "Tasks";
export const TASKS_PLUGIN_VERSION = "0.1.0";

export const tasksRpcContract = defineRpcContract({
  ping: {
    input: z.null(),
    output: z.object({ ok: z.literal(true), version: z.string() }),
  },
});

function statusPayload() {
  return { name: TASKS_PLUGIN_NAME, version: TASKS_PLUGIN_VERSION };
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info(`${TASKS_PLUGIN_NAME} ${TASKS_PLUGIN_VERSION} loaded`);

  const store = createStore(bb);
  registerTasksApi(bb, store);
  registerAttachments(bb, store.tasks);

  bb.rpc.register(tasksRpcContract, {
    ping(): { ok: true; version: string } {
      return { ok: true, version: TASKS_PLUGIN_VERSION };
    },
  });

  bb.cli.register({
    name: "tasks",
    summary: "Inspect the Tasks plugin scaffold",
    commands: [
      {
        name: "status",
        summary: "Print the Tasks plugin name and version",
        usage: "bb tasks status [--json]",
      },
    ],
    run(argv) {
      const [subcommand, ...flags] = argv;
      if (
        subcommand !== "status" ||
        flags.some((flag) => flag !== "--json") ||
        flags.filter((flag) => flag === "--json").length > 1
      ) {
        return {
          exitCode: 1,
          stderr: "Usage: bb tasks status [--json]",
        };
      }

      const status = statusPayload();
      return {
        exitCode: 0,
        stdout: flags.includes("--json")
          ? JSON.stringify(status)
          : `${status.name} ${status.version}`,
      };
    },
  });
}

import type { Command } from "commander";
import {
  threadPaneActionSchema,
  type ThreadPaneAction,
} from "@bb/server-contract";
import {
  resolveContextThreadId,
  resolveExplicitIdFlag,
} from "../../context-env.js";
import { clientCommand, mountCommand } from "../../operation-doors.js";
import { printThreadContextLabel, type ResolvedId } from "../helpers.js";

export function resolveThreadPaneTarget(id: string | undefined): ResolvedId {
  const explicit = resolveExplicitIdFlag({
    flagName: "<threadId> argument",
    value: id,
  });
  if (explicit !== undefined) {
    return { id: explicit, source: "arg" };
  }
  const context = resolveContextThreadId();
  if (context !== undefined) {
    return { id: context, source: "env" };
  }
  throw new Error(
    "Missing thread ID. Pass <threadId> or run inside a BB thread.",
  );
}

interface ThreadPaneInput {
  action: ThreadPaneAction;
  target: ResolvedId;
}

interface ThreadPaneOutput {
  action: ThreadPaneAction;
  target: ResolvedId;
  delivered: number;
}

export const threadPaneCommand = clientCommand<
  ThreadPaneInput,
  ThreadPaneOutput
>({
  name: "cli.thread.pane",
  kind: "write",
  description:
    "Resolve the target thread from the argument or BB_THREAD_ID, then run threads.paneAction",
  door: {
    path: ["thread", "pane"],
    summary: "Control an open thread pane in connected BB apps",
    usage: "<maximize|restore|toggle|spotlight|clear-spotlight> [id] [options]",
    positionals: [
      {
        name: "action",
        description:
          "Pane action: maximize, restore, toggle, spotlight, or clear-spotlight",
      },
      {
        name: "id",
        required: false,
        description: "Thread ID. Omit inside a BB thread.",
      },
    ],
    prepare: (values) => {
      const action = threadPaneActionSchema.parse(values.positionals.action);
      const id = values.positionals.id;
      return {
        action,
        target: resolveThreadPaneTarget(
          typeof id === "string" ? id : undefined,
        ),
      };
    },
    run: async ({ action, target }, client) => {
      const result = await client.call("threads.paneAction", {
        id: target.id,
        action,
      });
      return { action, target, delivered: result.delivered };
    },
    json: ({ action, target, delivered }) => ({
      threadId: target.id,
      action,
      delivered,
    }),
    print: ({ action, target, delivered }) => {
      printThreadContextLabel(target);
      return [
        `Thread: ${target.id}`,
        `Pane action: ${action}`,
        `Delivered: ${delivered}`,
      ];
    },
  },
});

export function registerPaneCommand(
  parent: Command,
  getUrl: () => string,
): void {
  mountCommand(parent, threadPaneCommand, { getUrl });
}

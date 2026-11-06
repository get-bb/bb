import type { Command } from "commander";
import { threadPaneActionSchema } from "@bb/server-contract";
import { arg } from "../../cli-door.js";
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

export const threadPaneCommand = clientCommand({
  path: ["thread", "pane"],
  summary: "Control an open thread pane in connected BB apps",
  usage: "<maximize|restore|toggle|spotlight|clear-spotlight> [id] [options]",
  positionals: {
    action: arg(
      "<action>",
      "Pane action: maximize, restore, toggle, spotlight, or clear-spotlight",
    ),
    id: arg("[id]", "Thread ID. Omit inside a BB thread."),
  },
  run: async ({ positionals }, client) => {
    const action = threadPaneActionSchema.parse(positionals.action);
    const target = resolveThreadPaneTarget(positionals.id);
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
});

export function registerPaneCommand(
  parent: Command,
  getUrl: () => string,
): void {
  mountCommand(parent, threadPaneCommand, { getUrl });
}

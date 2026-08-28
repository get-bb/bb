import { Command } from "commander";
import {
  threadVisibilitySchema,
  type PromptInput,
  type Thread,
} from "@bb/domain";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { resolveExplicitIdFlag } from "../../context-env.js";
import { outputJson, prependErrorContext } from "../helpers.js";
import type { ThreadForkArgs } from "@bb/sdk";
import {
  buildPromptInputs,
  collectOption,
  parsePermissionMode,
  PERMISSION_MODE_HELP,
} from "./helpers.js";

interface ThreadForkCommandOptions {
  agentContextSeed?: string;
  file?: string[];
  image?: string[];
  json?: boolean;
  permissionMode?: string;
  prompt?: string;
  sourceSeqEnd?: string;
  title?: string;
  visibility?: string;
  workspace?: string;
}

function parseSourceSeqEnd(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--source-seq-end must be a non-negative integer.");
  }
  return parsed;
}

function parseWorkspace(value: string | undefined): "isolated" | "reuse" {
  const workspace = value ?? "isolated";
  if (workspace !== "isolated" && workspace !== "reuse") {
    throw new Error("--workspace must be isolated or reuse.");
  }
  return workspace;
}

function buildForkInput(
  opts: ThreadForkCommandOptions,
): PromptInput[] | undefined {
  const files = opts.file ?? [];
  const images = opts.image ?? [];
  if (opts.prompt === undefined && files.length === 0 && images.length === 0) {
    return undefined;
  }
  if (opts.prompt !== undefined) {
    return buildPromptInputs({ message: opts.prompt, files, images });
  }
  return [
    ...files.map((path): PromptInput => ({ type: "localFile", path })),
    ...images.map((path): PromptInput => ({ type: "localImage", path })),
  ];
}

export function registerForkCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("fork <source-thread-id>")
    .description("Fork a thread at its tip or a source event sequence")
    .option("--prompt <prompt>", "Optional first prompt; omit for an idle fork")
    .option("--title <title>", "Thread title")
    .option(
      "--source-seq-end <seq>",
      "Fork after the source turn containing this event sequence",
    )
    .option("--workspace <mode>", "Workspace: isolated (default) or reuse")
    .option("--permission-mode <mode>", PERMISSION_MODE_HELP)
    .option("--visibility <visibility>", "Thread visibility: visible or hidden")
    .option(
      "--agent-context-seed <text>",
      "Persist agent-only context on the fork start",
    )
    .option(
      "--file <path>",
      "Pass a host-readable absolute or uploaded attachment file path (repeatable)",
      collectOption,
      [],
    )
    .option(
      "--image <path>",
      "Pass a host-readable absolute or uploaded attachment image path (repeatable)",
      collectOption,
      [],
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (sourceThreadIdValue: string, opts: ThreadForkCommandOptions) => {
          const sourceThreadId = resolveExplicitIdFlag({
            flagName: "source thread ID",
            value: sourceThreadIdValue,
          });
          if (!sourceThreadId) {
            throw new Error("Source thread ID is required.");
          }
          const input = buildForkInput(opts);
          const sourceSeqEnd = parseSourceSeqEnd(opts.sourceSeqEnd);
          const permissionMode = parsePermissionMode(opts.permissionMode);
          const visibility =
            opts.visibility === undefined
              ? undefined
              : threadVisibilitySchema.parse(opts.visibility);
          const workspace = parseWorkspace(opts.workspace);

          let thread: Thread;
          try {
            const forkArgs: ThreadForkArgs = {
              sourceThreadId,
              origin: "cli",
              workspace,
            };
            if (input !== undefined) forkArgs.input = input;
            if (sourceSeqEnd !== undefined)
              forkArgs.sourceSeqEnd = sourceSeqEnd;
            if (opts.title !== undefined) forkArgs.title = opts.title;
            if (permissionMode !== undefined)
              forkArgs.permissionMode = permissionMode;
            if (visibility !== undefined) forkArgs.visibility = visibility;
            if (opts.agentContextSeed !== undefined) {
              forkArgs.agentContextSeed = [
                {
                  type: "text",
                  text: opts.agentContextSeed,
                  mentions: [],
                  visibility: "agent-only",
                },
              ];
            }
            thread = await createCliBbSdk(getUrl()).threads.fork(forkArgs);
          } catch (error: unknown) {
            throw prependErrorContext(
              `Failed to fork thread ${sourceThreadId}`,
              error,
            );
          }

          if (outputJson(opts, thread)) return;
          console.log(`Thread forked: ${thread.id}`);
          console.log(`Source: ${sourceThreadId}`);
          console.log(`Status: ${thread.status}`);
          console.log(`Workspace: ${workspace}`);
          if (thread.visibility === "hidden") {
            console.log("Visibility: hidden");
          }
        },
      ),
    );
}

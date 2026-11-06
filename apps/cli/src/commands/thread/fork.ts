import type { Command } from "commander";
import {
  threadVisibilitySchema,
  type PromptInput,
  type Thread,
} from "@bb/domain";
import type { EnvironmentArgs } from "@bb/server-contract";
import { arg, flag } from "../../cli-door.js";
import {
  clientCommand,
  mountCommands,
  type CliClient,
} from "../../operation-doors.js";
import { resolveExplicitIdFlag } from "../../context-env.js";
import { resolveTextInput, TEXT_FILE_HELP_SUFFIX } from "../../text-input.js";
import { prependErrorContext } from "../helpers.js";
import {
  buildPromptInputs,
  parsePermissionMode,
  PERMISSION_MODE_HELP,
  uploadClientAttachmentInputs,
} from "./helpers.js";
import {
  buildSpawnEnvironment,
  looksLikePath,
  resolveSpawnEnvironmentValue,
} from "./spawn.js";

function parseSourceSeqEnd(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--source-seq-end must be a non-negative integer.");
  }
  return parsed;
}

async function buildForkInput(opts: {
  file: string[];
  image: string[];
  prompt: string | undefined;
  promptFile: string | undefined;
}): Promise<PromptInput[] | undefined> {
  const files = opts.file;
  const images = opts.image;
  const prompt = await resolveTextInput({
    file: opts.promptFile,
    fileLabel: "--prompt-file",
    inline: opts.prompt,
    inlineLabel: "--prompt <prompt>",
  });
  if (prompt === undefined && files.length === 0 && images.length === 0) {
    return undefined;
  }
  if (prompt !== undefined) {
    return buildPromptInputs({ message: prompt, files, images });
  }
  return [
    ...files.map((path): PromptInput => ({ type: "localFile", path })),
    ...images.map((path): PromptInput => ({ type: "localImage", path })),
  ];
}

async function resolveForkSourceHostId(
  client: CliClient,
  sourceThreadId: string,
): Promise<string> {
  const sourceThread = await client.call("threads.get", { id: sourceThreadId });
  if (sourceThread.environmentId === null) {
    throw new Error("Source thread has no environment.");
  }
  const sourceEnvironment = await client.call("environments.get", {
    id: sourceThread.environmentId,
  });
  return sourceEnvironment.hostId;
}

function describeForkEnvironment(
  environment: EnvironmentArgs | undefined,
): string {
  if (environment === undefined) return "source environment";
  if (environment.type === "reuse") return environment.environmentId;
  if (environment.workspace.type === "managed-worktree") {
    return "new worktree";
  }
  if (environment.workspace.type === "personal") return "new personal";
  return environment.workspace.path ?? "host project source";
}

interface ThreadForkOutput {
  thread: Thread;
  sourceThreadId: string;
  environment: EnvironmentArgs | undefined;
}

const UPLOAD_HELP =
  "Upload an absolute path or file: URL from this CLI machine or pass an uploaded attachment path (repeatable)";

export const threadForkCommand = clientCommand({
  path: ["thread", "fork"],
  summary: "Fork a thread at its tip or a source event sequence",
  positionals: { sourceThreadId: arg("<source-thread-id>") },
  options: {
    lifecycleOwnerThread: flag(
      "--lifecycle-owner-thread <id>",
      "Archive/delete this thread with its lifecycle owner",
    ),
    prompt: flag(
      "--prompt <prompt>",
      "Optional first prompt; omit for an idle fork",
    ),
    promptFile: flag(
      "--prompt-file <path>",
      `Read the first prompt from a file instead of --prompt; ${TEXT_FILE_HELP_SUFFIX}`,
    ),
    title: flag(
      "--title <title>",
      'Thread title; idle forks default to the numbered source title, e.g. "(1) foo"',
    ),
    sourceSeqEnd: flag(
      "--source-seq-end <seq>",
      "Fork after the source turn containing this event sequence",
    ),
    environment: flag(
      "--environment <id-or-path>",
      "Existing environment ID or unmanaged workspace path",
    ),
    newEnvironment: flag(
      "--new-environment <kind>",
      "Create a fresh environment of the given kind (personal or worktree)",
    ),
    baseBranch: flag(
      "--base-branch <branch>",
      "Base branch or ref; a named branch uses origin/<name> unless local has commits it lacks (use refs/heads/<name> to force local)",
    ),
    permissionMode: flag("--permission-mode <mode>", PERMISSION_MODE_HELP),
    visibility: flag(
      "--visibility <visibility>",
      "Thread visibility: visible or hidden",
    ),
    agentContextSeed: flag(
      "--agent-context-seed <text>",
      "Persist agent-only context on the fork start",
    ),
    file: flag("--file <path>", UPLOAD_HELP, { type: "strings", default: [] }),
    image: flag("--image <path>", UPLOAD_HELP, {
      type: "strings",
      default: [],
    }),
  },
  run: async ({ positionals, options }, client): Promise<ThreadForkOutput> => {
    const sourceThreadId = resolveExplicitIdFlag({
      flagName: "source thread ID",
      value: positionals.sourceThreadId,
    });
    if (!sourceThreadId) {
      throw new Error("Source thread ID is required.");
    }
    const requestedInput = await buildForkInput(options);
    const sourceSeqEnd = parseSourceSeqEnd(options.sourceSeqEnd);
    const permissionMode = parsePermissionMode(options.permissionMode);
    const visibility =
      options.visibility === undefined
        ? undefined
        : threadVisibilitySchema.parse(options.visibility);
    const environmentValue = resolveSpawnEnvironmentValue(options.environment);

    let thread: Thread;
    let environment: EnvironmentArgs | undefined;
    try {
      const input =
        requestedInput === undefined
          ? undefined
          : await uploadClientAttachmentInputs({
              input: requestedInput,
              resolveProjectId: async () =>
                (await client.call("threads.get", { id: sourceThreadId }))
                  .projectId,
              sdk: client.sdk(),
            });
      const needsHostId =
        Boolean(options.newEnvironment) ||
        (environmentValue !== undefined && looksLikePath(environmentValue));
      const hostId = needsHostId
        ? await resolveForkSourceHostId(client, sourceThreadId)
        : null;
      if (
        environmentValue === undefined &&
        options.newEnvironment === undefined &&
        options.baseBranch === undefined
      ) {
        environment = undefined;
      } else {
        const builtEnvironment = buildSpawnEnvironment({
          defaultPersonalWorkspace: false,
          environmentValue,
          newEnvironmentKind: options.newEnvironment,
          hostId,
          baseBranch: options.baseBranch,
        });
        if (
          builtEnvironment.type === "project-default" ||
          builtEnvironment.type === "provider"
        ) {
          throw new Error("Fork environment flags resolved no environment");
        }
        environment = builtEnvironment;
      }
      thread = await client.call("threads.fork", {
        sourceThreadId,
        ...(options.lifecycleOwnerThread !== undefined
          ? { lifecycleOwnerThreadId: options.lifecycleOwnerThread }
          : {}),
        origin: "cli",
        ...(environment === undefined ? {} : { environment }),
        ...(input === undefined ? {} : { input }),
        ...(sourceSeqEnd === undefined ? {} : { sourceSeqEnd }),
        ...(options.title === undefined ? {} : { title: options.title }),
        ...(permissionMode === undefined ? {} : { permissionMode }),
        visibility: visibility ?? "visible",
        ...(options.agentContextSeed === undefined
          ? {}
          : {
              agentContextSeed: [
                {
                  type: "text",
                  text: options.agentContextSeed,
                  mentions: [],
                  visibility: "agent-only" as const,
                },
              ],
            }),
      });
    } catch (error: unknown) {
      throw prependErrorContext(
        `Failed to fork thread ${sourceThreadId}`,
        error,
      );
    }
    return { thread, sourceThreadId, environment };
  },
  json: (output) => output.thread,
  print: ({ thread, sourceThreadId, environment }) => [
    `Thread forked: ${thread.id}`,
    `Source: ${sourceThreadId}`,
    `Status: ${thread.status}`,
    `Environment: ${describeForkEnvironment(environment)}`,
    ...(thread.visibility === "hidden" ? ["Visibility: hidden"] : []),
  ],
});

export function registerForkCommand(
  parent: Command,
  getUrl: () => string,
): void {
  mountCommands(parent, [threadForkCommand], { getUrl });
}

import { flag } from "@bb/operations";
import type { Command } from "commander";
import {
  threadVisibilitySchema,
  type PromptInput,
  type Thread,
} from "@bb/domain";
import type { EnvironmentArgs } from "@bb/server-contract";
import type { CliDoorOption } from "@bb/operations";
import {
  clientCommand,
  mountCommands,
  type CliClient,
} from "../../operation-doors.js";
import { optionalString, stringList } from "./operation-doors.js";
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

interface ThreadForkCommandOptions {
  sourceThreadIdValue: string;
  agentContextSeed?: string;
  baseBranch?: string;
  environment?: string;
  file?: string[];
  image?: string[];
  newEnvironment?: string;
  permissionMode?: string;
  prompt?: string;
  promptFile?: string;
  sourceSeqEnd?: string;
  title?: string;
  lifecycleOwnerThread?: string;
  visibility?: string;
}

function parseSourceSeqEnd(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("--source-seq-end must be a non-negative integer.");
  }
  return parsed;
}

async function buildForkInput(
  opts: ThreadForkCommandOptions,
): Promise<PromptInput[] | undefined> {
  const files = opts.file ?? [];
  const images = opts.image ?? [];
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

function stringOption(
  flag: string,
  placeholder: string,
  description: string,
): CliDoorOption {
  return { flag, type: "string", placeholder, description };
}

export const threadForkCommand = clientCommand<
  ThreadForkCommandOptions,
  ThreadForkOutput
>({
  name: "cli.thread.fork",
  kind: "write",
  description:
    "Resolve the fork's environment, upload local attachments, then fork (threads.get, environments.get, projects.uploadAttachment, threads.fork)",
  door: {
    path: ["thread", "fork"],
    summary: "Fork a thread at its tip or a source event sequence",
    positionals: [{ name: "source-thread-id" }],
    options: [
      stringOption(
        "lifecycle-owner-thread",
        "id",
        "Archive/delete this thread with its lifecycle owner",
      ),
      stringOption(
        "prompt",
        "prompt",
        "Optional first prompt; omit for an idle fork",
      ),
      stringOption(
        "prompt-file",
        "path",
        `Read the first prompt from a file instead of --prompt; ${TEXT_FILE_HELP_SUFFIX}`,
      ),
      stringOption(
        "title",
        "title",
        'Thread title; idle forks default to the numbered source title, e.g. "(1) foo"',
      ),
      stringOption(
        "source-seq-end",
        "seq",
        "Fork after the source turn containing this event sequence",
      ),
      stringOption(
        "environment",
        "id-or-path",
        "Existing environment ID or unmanaged workspace path",
      ),
      stringOption(
        "new-environment",
        "kind",
        "Create a fresh environment of the given kind (personal or worktree)",
      ),
      stringOption(
        "base-branch",
        "branch",
        "Base branch or ref; a named branch uses origin/<name> unless local has commits it lacks (use refs/heads/<name> to force local)",
      ),
      stringOption("permission-mode", "mode", PERMISSION_MODE_HELP),
      stringOption(
        "visibility",
        "visibility",
        "Thread visibility: visible or hidden",
      ),
      stringOption(
        "agent-context-seed",
        "text",
        "Persist agent-only context on the fork start",
      ),
      flag("--file <path>", UPLOAD_HELP, { type: "strings", default: [] }),
      flag("--image <path>", UPLOAD_HELP, { type: "strings", default: [] }),
    ],
    prepare: ({ positionals, options }) => {
      const pick = (flag: string) => optionalString(options[flag]);
      const entries: [keyof ThreadForkCommandOptions, string | undefined][] = [
        ["lifecycleOwnerThread", pick("lifecycle-owner-thread")],
        ["prompt", pick("prompt")],
        ["promptFile", pick("prompt-file")],
        ["title", pick("title")],
        ["sourceSeqEnd", pick("source-seq-end")],
        ["environment", pick("environment")],
        ["newEnvironment", pick("new-environment")],
        ["baseBranch", pick("base-branch")],
        ["permissionMode", pick("permission-mode")],
        ["visibility", pick("visibility")],
        ["agentContextSeed", pick("agent-context-seed")],
      ];
      const opts: ThreadForkCommandOptions = {
        sourceThreadIdValue:
          optionalString(positionals["source-thread-id"]) ?? "",
        file: stringList(options.file),
        image: stringList(options.image),
      };
      for (const [key, value] of entries) {
        if (value !== undefined) Object.assign(opts, { [key]: value });
      }
      return opts;
    },
    async run(opts, client) {
      const sourceThreadId = resolveExplicitIdFlag({
        flagName: "source thread ID",
        value: opts.sourceThreadIdValue,
      });
      if (!sourceThreadId) {
        throw new Error("Source thread ID is required.");
      }
      const requestedInput = await buildForkInput(opts);
      const sourceSeqEnd = parseSourceSeqEnd(opts.sourceSeqEnd);
      const permissionMode = parsePermissionMode(opts.permissionMode);
      const visibility =
        opts.visibility === undefined
          ? undefined
          : threadVisibilitySchema.parse(opts.visibility);
      const environmentValue = resolveSpawnEnvironmentValue(opts.environment);

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
          Boolean(opts.newEnvironment) ||
          (environmentValue !== undefined && looksLikePath(environmentValue));
        const hostId = needsHostId
          ? await resolveForkSourceHostId(client, sourceThreadId)
          : null;
        if (
          environmentValue === undefined &&
          opts.newEnvironment === undefined &&
          opts.baseBranch === undefined
        ) {
          environment = undefined;
        } else {
          const builtEnvironment = buildSpawnEnvironment({
            defaultPersonalWorkspace: false,
            environmentValue,
            newEnvironmentKind: opts.newEnvironment,
            hostId,
            baseBranch: opts.baseBranch,
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
          ...(opts.lifecycleOwnerThread !== undefined
            ? { lifecycleOwnerThreadId: opts.lifecycleOwnerThread }
            : {}),
          origin: "cli",
          ...(environment === undefined ? {} : { environment }),
          ...(input === undefined ? {} : { input }),
          ...(sourceSeqEnd === undefined ? {} : { sourceSeqEnd }),
          ...(opts.title === undefined ? {} : { title: opts.title }),
          ...(permissionMode === undefined ? {} : { permissionMode }),
          visibility: visibility ?? "visible",
          ...(opts.agentContextSeed === undefined
            ? {}
            : {
                agentContextSeed: [
                  {
                    type: "text",
                    text: opts.agentContextSeed,
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
  },
});

export function registerForkCommand(
  parent: Command,
  getUrl: () => string,
): void {
  mountCommands(parent, [threadForkCommand], { getUrl });
}

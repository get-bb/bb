import type { Command } from "commander";
import {
  jsonValueSchema,
  PERSONAL_PROJECT_ID,
  threadVisibilitySchema,
  type EnvironmentMachineSelection,
  type Thread,
  type ThreadParentNotifications,
  type JsonValue,
  type GitBranchSelection,
} from "@bb/domain";
import type { CreateThreadEnvironmentArgs } from "@bb/server-contract";
import { CliUsageError } from "../../action.js";
import { flag } from "../../cli-door.js";
import {
  clientCommand,
  mountCommands,
  type CliClient,
} from "../../operation-doors.js";
import { JSON_FLAG } from "./operation-doors.js";
import { missingProjectHint } from "../../context-hints.js";
import { requireTextInput, TEXT_FILE_HELP_SUFFIX } from "../../text-input.js";
import {
  resolveExplicitIdFlag,
  resolveContextThreadId,
} from "../../context-env.js";
import { resolveLocalHostId } from "../../daemon.js";
import {
  resolveMachineHostId,
  resolveMachineTargetOption,
} from "../machine.js";
import { parseReasoningLevel, prependErrorContext } from "../helpers.js";
import {
  parsePermissionMode,
  buildPromptInputs,
  uploadClientAttachmentInputs,
  PARENT_NOTIFICATIONS_HELP,
  PERMISSION_MODE_HELP,
  PLAN_HELP,
  parseParentNotifications,
  parseServiceTier,
  SERVICE_TIER_HELP,
} from "./helpers.js";
import { parseSpawnSessionOptions } from "./session-state.js";
import { SEND_AT_HELP, parseSendAt } from "./send-time.js";

const PROVIDER_HELP =
  "Provider ID for the thread. Omit to use the project's remembered provider choice";

export function looksLikePath(value: string): boolean {
  return (
    value.includes("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith(".") ||
    value.startsWith("~")
  );
}

export function requireHostId(hostId: string | null): string {
  if (!hostId) {
    throw new Error("Cannot reach local host daemon. Is it running?");
  }
  return hostId;
}

export function resolveSpawnEnvironmentValue(
  flagValue?: string,
): string | undefined {
  const trimmedValue = flagValue?.trim();
  if (!trimmedValue) return undefined;
  if (looksLikePath(trimmedValue)) return trimmedValue;
  return resolveExplicitIdFlag({
    flagName: "--environment flag",
    value: trimmedValue,
  });
}

function resolveSpawnParentThreadId(args: {
  parentSelf?: boolean;
  parentThread?: string;
}): string | undefined {
  const explicitParentThreadId = resolveExplicitIdFlag({
    flagName: "--parent-thread",
    value: args.parentThread,
  });
  if (explicitParentThreadId && args.parentSelf) {
    throw new Error("Cannot combine --parent-thread with --parent-self.");
  }
  if (args.parentSelf) {
    const selfThreadId = resolveContextThreadId();
    if (!selfThreadId) {
      throw new Error("--parent-self requires BB_THREAD_ID to be set.");
    }
    return selfThreadId;
  }
  return explicitParentThreadId;
}

export function buildSpawnEnvironment(args: {
  defaultPersonalWorkspace: boolean;
  environmentValue?: string;
  newEnvironmentKind?: string;
  hostId: string | null;
  baseBranch?: string;
}): CreateThreadEnvironmentArgs {
  const environmentValue = args.environmentValue?.trim();
  const newEnvironmentKind = args.newEnvironmentKind?.trim();
  const trimmedBaseBranch = args.baseBranch?.trim();
  const baseBranch: GitBranchSelection = trimmedBaseBranch
    ? { kind: "named", name: trimmedBaseBranch }
    : { kind: "default" };

  if (environmentValue && newEnvironmentKind) {
    throw new Error("Cannot combine --environment with --new-environment.");
  }
  if (trimmedBaseBranch && newEnvironmentKind !== "worktree") {
    throw new Error("--base-branch requires --new-environment worktree.");
  }
  if (newEnvironmentKind) {
    if (newEnvironmentKind === "personal") {
      return {
        type: "host",
        hostId: requireHostId(args.hostId),
        workspace: { type: "personal" },
      };
    }
    if (newEnvironmentKind === "worktree") {
      return {
        type: "host",
        hostId: requireHostId(args.hostId),
        workspace: { type: "managed-worktree", baseBranch },
      };
    }
    throw new Error(
      `Unknown environment kind '${newEnvironmentKind}'. Supported: personal, worktree.`,
    );
  }
  if (!environmentValue) {
    if (args.hostId !== null) {
      return {
        type: "host",
        hostId: args.hostId,
        workspace: args.defaultPersonalWorkspace
          ? { type: "personal" }
          : { type: "unmanaged", path: null },
      };
    }
    return { type: "project-default" };
  }
  if (looksLikePath(environmentValue)) {
    return {
      type: "host",
      hostId: requireHostId(args.hostId),
      workspace: { type: "unmanaged", path: environmentValue },
    };
  }
  return {
    type: "reuse",
    environmentId: environmentValue,
  };
}

function parseJsonFlag(
  flagValue: string | undefined,
  flagName: "--environment-inputs" | "--machine-inputs",
): JsonValue | null {
  if (flagValue === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(flagValue);
  } catch {
    throw new Error(`${flagName} must be valid JSON.`);
  }
  return jsonValueSchema.parse(parsed);
}

async function buildProviderSpawnEnvironment(args: {
  client: CliClient;
  environmentProvider: string;
  environmentInputs: string | undefined;
  environmentValue: string | undefined;
  newEnvironmentKind: string | undefined;
  baseBranch: string | undefined;
  machineHostId: string | null;
  machine: EnvironmentMachineSelection | null;
  machineInputs: JsonValue | null;
  machineInputsProvided: boolean;
  projectId: string;
  resolveDefaultHostId: () => Promise<string | null>;
}): Promise<CreateThreadEnvironmentArgs> {
  if (args.environmentValue || args.newEnvironmentKind) {
    throw new Error(
      "Cannot combine --environment-provider with --environment or --new-environment.",
    );
  }
  if (args.baseBranch?.trim()) {
    throw new Error(
      "--base-branch requires --new-environment worktree; an --environment-provider takes its branch through --environment-inputs.",
    );
  }
  const requested = args.environmentProvider.trim();
  const { providers } = await args.client.call("system.environmentProviders", {
    projectId: args.projectId,
  });
  const match = providers.find((provider) => provider.id === requested);
  if (match === undefined) {
    const available = providers.map((provider) => provider.id).join(", ");
    throw new Error(
      `Unknown environment provider '${requested}'.${available ? ` Available: ${available}.` : ""}`,
    );
  }
  let inputs = parseJsonFlag(args.environmentInputs, "--environment-inputs");
  if (match.inputs !== null && inputs === null) {
    if (match.acceptsEmptyInputs) {
      inputs = {};
    } else {
      throw new Error(
        `The '${match.id}' environment provider needs --environment-inputs <json>; \`bb environment providers --json\` shows its schema.`,
      );
    }
  }
  if (match.inputs === null && inputs !== null) {
    throw new Error(
      `The '${match.id}' environment provider takes no --environment-inputs.`,
    );
  }
  if (match.machineProviderId) {
    if (args.machine !== null || args.machineHostId !== null)
      throw new Error(
        "This environment provider chooses its own new machine; omit machine selectors.",
      );
    let machineInputs = args.machineInputs;
    if (match.machineInputs !== undefined) {
      if (match.machineInputs !== null && machineInputs === null) {
        if (match.machineAcceptsEmptyInputs) machineInputs = {};
        else {
          throw new Error(
            `The '${match.machineProviderId}' machine provider needs --machine-inputs <json>; \`bb environment providers --json\` shows its schema.`,
          );
        }
      }
      if (match.machineInputs === null && machineInputs !== null) {
        throw new Error(
          `The '${match.machineProviderId}' machine provider takes no --machine-inputs.`,
        );
      }
    }
    return {
      type: "provider",
      environmentProviderId: match.id,
      ...(match.machineInputs === undefined || match.machineInputs === null
        ? {}
        : {
            machine: {
              type: "new" as const,
              machineProviderId: match.machineProviderId,
              inputs: machineInputs,
            },
          }),
      inputs,
    };
  }
  if (args.machineInputsProvided && args.machine === null) {
    throw new Error(
      "--machine-inputs requires --new-machine <provider-id> or a composed --environment-provider.",
    );
  }
  const machine = args.machine ?? {
    type: "existing" as const,
    hostId: requireHostId(
      args.machineHostId ?? (await args.resolveDefaultHostId()),
    ),
  };
  return {
    type: "provider",
    environmentProviderId: match.id,
    machine,
    inputs,
  };
}

interface ThreadSpawnOutput {
  thread: Thread;
  sendAt: number | null;
}

export const threadSpawnCommand = clientCommand({
  path: ["thread", "spawn"],
  summary:
    "Spawn a new thread; omitted execution flags use remembered project defaults, then the target provider catalog default",
  aliases: ["create", "new"],
  options: {
    prompt: flag(
      "--prompt <prompt>",
      "Initial prompt for the thread (required unless --prompt-file is given)",
    ),
    promptFile: flag(
      "--prompt-file <path>",
      `Read the initial prompt from a file instead of --prompt; ${TEXT_FILE_HELP_SUFFIX}`,
    ),
    lifecycleOwnerThread: flag(
      "--lifecycle-owner-thread <id>",
      "Archive/delete this thread with its lifecycle owner",
    ),
    json: JSON_FLAG,
    project: flag("--project <id>", "Project ID", { required: true }),
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
    machine: flag(
      "--machine <id-or-name>",
      "Execution machine ID or unambiguous name",
    ),
    host: flag("--host <id-or-name>", "Alias for --machine"),
    newMachine: flag(
      "--new-machine <provider-id>",
      "Create the thread on a new machine from this machine provider",
    ),
    machineInputs: flag(
      "--machine-inputs <json>",
      "Persisted non-secret inputs for --new-machine or a composed --environment-provider; store credentials in plugin settings",
    ),
    parentThread: flag(
      "--parent-thread <id>",
      "Parent thread ID for worker thread links",
    ),
    parentSelf: flag("--parent-self", "Parent the new thread to BB_THREAD_ID"),
    provider: flag("--provider <id>", PROVIDER_HELP),
    model: flag(
      "--model <model>",
      "Model ID for the thread. Omit to use the project's remembered default for the resolved provider",
    ),
    reasoningLevel: flag(
      "--reasoning-level <level>",
      "Reasoning level id the model lists: low, medium, high, xhigh, max, or a provider-specific id",
    ),
    title: flag("--title <title>", "Thread title"),
    serviceTier: flag("--service-tier <tier>", SERVICE_TIER_HELP),
    option: flag(
      "--option <option=value>",
      "Choose a value for an option the provider's model lists (see bb provider models); use true or false for an on/off option (repeatable)",
      { type: "strings" },
    ),
    permissionMode: flag("--permission-mode <mode>", PERMISSION_MODE_HELP),
    plan: flag("--plan", PLAN_HELP),
    file: flag(
      "--file <path>",
      "Upload an absolute path or file: URL from this CLI machine or pass an uploaded attachment path (repeatable)",
      { type: "strings", default: [] },
    ),
    image: flag(
      "--image <path>",
      "Upload an absolute path or file: URL from this CLI machine or pass an uploaded attachment path (repeatable)",
      { type: "strings", default: [] },
    ),
    section: flag("--section <id>", "Create the thread in a section"),
    pinned: flag("--pinned", "Create the thread in Pinned"),
    visibility: flag(
      "--visibility <visibility>",
      "Thread visibility: visible or hidden (a child inherits its parent)",
    ),
    parentNotifications: flag(
      "--parent-notifications <value>",
      PARENT_NOTIFICATIONS_HELP,
    ),
    environmentProvider: flag(
      "--environment-provider <id>",
      "Run on an environment provider by id (list them with `bb environment providers`)",
    ),
    environmentInputs: flag(
      "--environment-inputs <json>",
      "JSON value for an --environment-provider that declares inputs (`bb environment providers --json` shows the schema)",
    ),
    sendAt: flag("--send-at <when>", SEND_AT_HELP),
    originKind: flag("--origin-kind <kind>", "Thread origin: fork"),
    sourceThread: flag("--source-thread <id>", "Source thread for a fork"),
    sourceSeqEnd: flag(
      "--source-seq-end <seq>",
      "Fork after the source turn containing this event sequence",
    ),
  },
  run: async ({ options }, client): Promise<ThreadSpawnOutput> => {
    const prompt = await requireTextInput({
      file: options.promptFile,
      fileLabel: "--prompt-file",
      inline: options.prompt,
      inlineLabel: "--prompt <prompt>",
    });
    const projectId = resolveExplicitIdFlag({
      flagName: "--project flag",
      value: options.project,
    });
    if (!projectId) {
      throw new CliUsageError({
        code: "missing_required",
        hint: missingProjectHint(),
        message: "Missing required option --project <id>.",
      });
    }
    const environmentValue = resolveSpawnEnvironmentValue(options.environment);
    if (
      options.environmentInputs !== undefined &&
      !options.environmentProvider &&
      !options.newMachine
    ) {
      throw new Error(
        "--environment-inputs requires --environment-provider <id>.",
      );
    }
    const machineTarget = resolveMachineTargetOption(options);
    if (machineTarget && options.newMachine) {
      throw new Error("Cannot combine --new-machine with --machine or --host.");
    }
    if (options.machineInputs !== undefined && !options.newMachine) {
      if (!options.environmentProvider)
        throw new Error(
          "--machine-inputs requires --new-machine <provider-id> or a composed --environment-provider.",
        );
    }
    if (machineTarget && environmentValue && !looksLikePath(environmentValue)) {
      throw new Error(
        "Cannot combine --machine or --host with an existing environment ID; that environment already selects its machine.",
      );
    }
    const machineProvider = options.newMachine
      ? (await client.call("system.machineProviders", {})).providers.find(
          (provider) => provider.id === options.newMachine?.trim(),
        )
      : undefined;
    if (options.newMachine && machineProvider === undefined) {
      throw new Error(
        `Unknown machine provider '${options.newMachine.trim()}'.`,
      );
    }
    let machineInputs = parseJsonFlag(
      options.machineInputs,
      "--machine-inputs",
    );
    if (
      machineProvider &&
      machineProvider.inputs !== null &&
      machineInputs === null
    ) {
      if (machineProvider.acceptsEmptyInputs) machineInputs = {};
      else {
        throw new Error(
          `The '${machineProvider?.id}' machine provider needs --machine-inputs <json>; \`bb machine providers --json\` shows its schema.`,
        );
      }
    }
    if (
      machineProvider &&
      machineProvider.inputs === null &&
      machineInputs !== null
    ) {
      throw new Error(
        `The '${machineProvider.id}' machine provider takes no --machine-inputs.`,
      );
    }
    const newMachineSelection =
      machineProvider === undefined
        ? null
        : {
            type: "new" as const,
            machineProviderId: machineProvider.id,
            inputs: machineInputs,
          };
    const selectedEnvironmentProvider = options.environmentProvider;
    if (machineProvider && selectedEnvironmentProvider === undefined) {
      throw new Error(
        `The '${machineProvider.id}' machine provider requires an environment provider; combine --new-machine with --environment-provider <id>.`,
      );
    }
    const needsHostId =
      !options.environmentProvider &&
      !options.newMachine &&
      (Boolean(options.newEnvironment) ||
        (environmentValue !== undefined && looksLikePath(environmentValue)));
    const hostId = machineTarget
      ? await resolveMachineHostId({
          serverUrl: client.url,
          target: machineTarget,
        })
      : needsHostId
        ? await resolveLocalHostId()
        : null;
    const environment = selectedEnvironmentProvider
      ? await buildProviderSpawnEnvironment({
          client,
          environmentProvider: selectedEnvironmentProvider,
          environmentInputs: options.environmentInputs,
          environmentValue,
          newEnvironmentKind: options.newEnvironment,
          baseBranch: options.baseBranch,
          machineHostId: hostId,
          machine: newMachineSelection,
          machineInputs,
          machineInputsProvided: options.machineInputs !== undefined,
          projectId,
          resolveDefaultHostId: resolveLocalHostId,
        })
      : buildSpawnEnvironment({
          defaultPersonalWorkspace: projectId === PERSONAL_PROJECT_ID,
          environmentValue,
          newEnvironmentKind: options.newEnvironment,
          hostId,
          baseBranch: options.baseBranch,
        });
    const reasoningLevel = parseReasoningLevel(options.reasoningLevel);
    const serviceTier = parseServiceTier(options.serviceTier);
    const sessionOptions = parseSpawnSessionOptions(options.option);
    const permissionMode = parsePermissionMode(options.permissionMode);
    const visibility =
      options.visibility === undefined
        ? undefined
        : threadVisibilitySchema.parse(options.visibility);
    const parentNotifications = parseParentNotifications(
      options.parentNotifications,
    );
    const parentThreadId = resolveSpawnParentThreadId({
      parentSelf: options.parentSelf,
      parentThread: options.parentThread,
    });
    if (options.originKind !== undefined && options.originKind !== "fork") {
      throw new Error("--origin-kind must be fork.");
    }
    const sourceSeqEnd =
      options.sourceSeqEnd === undefined
        ? undefined
        : Number(options.sourceSeqEnd);
    if (
      sourceSeqEnd !== undefined &&
      (!Number.isInteger(sourceSeqEnd) || sourceSeqEnd < 0)
    ) {
      throw new Error("--source-seq-end must be a non-negative integer.");
    }
    const sendAt =
      options.sendAt === undefined ? undefined : parseSendAt(options.sendAt);
    const providerId = options.provider?.trim();

    let thread: Thread;
    try {
      const input = await uploadClientAttachmentInputs({
        input: buildPromptInputs({
          message: prompt,
          plan: options.plan,
          files: options.file,
          images: options.image,
        }),
        resolveProjectId: async () => projectId,
        sdk: client.sdk(),
      });
      thread = await client.call("threads.create", {
        projectId,
        ...(providerId ? { providerId } : {}),
        ...(options.model ? { model: options.model } : {}),
        input,
        ...(reasoningLevel ? { reasoningLevel } : {}),
        ...(options.title ? { title: options.title } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        ...(Object.keys(sessionOptions).length > 0 ? { sessionOptions } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(visibility ? { visibility } : {}),
        environment,
        ...(parentThreadId ? { parentThreadId } : {}),
        ...(process.env.BB_THREAD_ID
          ? { senderThreadId: process.env.BB_THREAD_ID }
          : {}),
        ...(parentNotifications ? { parentNotifications } : {}),
        ...(options.lifecycleOwnerThread !== undefined
          ? { lifecycleOwnerThreadId: options.lifecycleOwnerThread }
          : {}),
        ...(options.section ? { sectionId: options.section } : {}),
        ...(options.pinned ? { pinned: true } : {}),
        ...(options.sourceThread
          ? { sourceThreadId: options.sourceThread }
          : {}),
        ...(sourceSeqEnd !== undefined ? { sourceSeqEnd } : {}),
        ...(sendAt !== undefined ? { sendAt } : {}),
        origin: "cli",
        startedOnBehalfOf: null,
        originKind: options.originKind === "fork" ? "fork" : null,
      });
    } catch (err: unknown) {
      throw prependErrorContext("Failed to create thread", err);
    }

    return { thread, sendAt: sendAt ?? null };
  },
  json: (output) => output.thread,
  print: ({ thread, sendAt }) => {
    const lines = [`Thread spawned: ${thread.id}`];
    if (sendAt !== null) {
      lines.push(
        `First message scheduled for ${new Date(sendAt).toLocaleString()}; the thread stays pending until then.`,
      );
    }
    if (
      thread.parentThreadId &&
      thread.parentThreadId === resolveContextThreadId()
    ) {
      lines.push(parentNotificationsPromise(thread.parentNotifications));
    }
    return [...lines, ...threadLines(thread)];
  },
});

export function registerSpawnCommand(
  parent: Command,
  getUrl: () => string,
): void {
  mountCommands(parent, [threadSpawnCommand], { getUrl });
}

function parentNotificationsPromise(
  parentNotifications: ThreadParentNotifications,
): string {
  switch (parentNotifications) {
    case "auto":
      return "You will be notified when this thread is done.";
    case "stuck":
      return "You will be notified only if this thread fails, is interrupted, or is blocked.";
    case "off":
      return "You will not be notified about this thread.";
  }
}

function threadLines(thread: Thread): string[] {
  return [
    "",
    `  ID:       ${thread.id}`,
    `  Project:  ${thread.projectId === PERSONAL_PROJECT_ID ? "-" : thread.projectId}`,
    `  Status:   ${thread.status}`,
    ...(thread.visibility === "hidden" ? ["  Visibility: hidden"] : []),
    ...(thread.archivedAt === null
      ? []
      : [`  Archived: ${new Date(thread.archivedAt).toLocaleString()}`]),
    `  Created:  ${new Date(thread.createdAt).toLocaleString()}`,
    `  Updated:  ${new Date(thread.updatedAt).toLocaleString()}`,
    "",
  ];
}

import { flag } from "@bb/operations";
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
import {
  clientCommand,
  mountCommands,
  type CliClient,
} from "../../operation-doors.js";
import { JSON_OPTION, optionalString, stringList } from "./operation-doors.js";
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

interface ThreadSpawnCommandOptions {
  prompt?: string;
  promptFile?: string;
  json?: boolean;
  project?: string;
  environment?: string;
  newEnvironment?: string;
  environmentProvider?: string;
  environmentInputs?: string;
  baseBranch?: string;
  parentThread?: string;
  provider?: string;
  model?: string;
  reasoningLevel?: string;
  title?: string;
  lifecycleOwnerThread?: string;
  serviceTier?: string;
  option?: string[];
  permissionMode?: string;
  plan?: boolean;
  parentSelf?: boolean;
  machine?: string;
  host?: string;
  newMachine?: string;
  machineInputs?: string;
  file?: string[];
  image?: string[];
  section?: string;
  pinned?: boolean;
  originKind?: string;
  sourceThread?: string;
  sourceSeqEnd?: string;
  visibility?: string;
  parentNotifications?: string;
  sendAt?: string;
}

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

export const threadSpawnCommand = clientCommand<
  ThreadSpawnCommandOptions,
  ThreadSpawnOutput
>({
  name: "cli.thread.spawn",
  kind: "write",
  description:
    "Resolve the machine and environment, upload local attachments, then create the thread (system.machineProviders, system.environmentProviders, hosts.list, projects.uploadAttachment, threads.create)",
  door: {
    path: ["thread", "spawn"],
    summary:
      "Spawn a new thread; omitted execution flags use remembered project defaults, then the target provider catalog default",
    aliases: ["create", "new"],
    options: [
      flag(
        "--prompt <prompt>",
        "Initial prompt for the thread (required unless --prompt-file is given)",
      ),
      flag(
        "--prompt-file <path>",
        `Read the initial prompt from a file instead of --prompt; ${TEXT_FILE_HELP_SUFFIX}`,
      ),
      flag(
        "--lifecycle-owner-thread <id>",
        "Archive/delete this thread with its lifecycle owner",
      ),
      JSON_OPTION,
      flag("--project <id>", "Project ID", { required: true }),
      flag(
        "--environment <id-or-path>",
        "Existing environment ID or unmanaged workspace path",
      ),
      flag(
        "--new-environment <kind>",
        "Create a fresh environment of the given kind (personal or worktree)",
      ),
      flag(
        "--base-branch <branch>",
        "Base branch or ref; a named branch uses origin/<name> unless local has commits it lacks (use refs/heads/<name> to force local)",
      ),
      flag(
        "--machine <id-or-name>",
        "Execution machine ID or unambiguous name",
      ),
      flag("--host <id-or-name>", "Alias for --machine"),
      flag(
        "--new-machine <provider-id>",
        "Create the thread on a new machine from this machine provider",
      ),
      flag(
        "--machine-inputs <json>",
        "Persisted non-secret inputs for --new-machine or a composed --environment-provider; store credentials in plugin settings",
      ),
      flag("--parent-thread <id>", "Parent thread ID for worker thread links"),
      flag("--parent-self", "Parent the new thread to BB_THREAD_ID"),
      flag("--provider <id>", PROVIDER_HELP),
      flag(
        "--model <model>",
        "Model ID for the thread. Omit to use the project's remembered default for the resolved provider",
      ),
      flag(
        "--reasoning-level <level>",
        "Reasoning level id the model lists: low, medium, high, xhigh, max, or a provider-specific id",
      ),
      flag("--title <title>", "Thread title"),
      flag("--service-tier <tier>", SERVICE_TIER_HELP),
      flag(
        "--option <option=value>",
        "Choose a value for an option the provider's model lists (see bb provider models); use true or false for an on/off option (repeatable)",
        { type: "strings" },
      ),
      flag("--permission-mode <mode>", PERMISSION_MODE_HELP),
      flag("--plan", PLAN_HELP),
      flag(
        "--file <path>",
        "Upload an absolute path or file: URL from this CLI machine or pass an uploaded attachment path (repeatable)",
        { type: "strings", default: [] },
      ),
      flag(
        "--image <path>",
        "Upload an absolute path or file: URL from this CLI machine or pass an uploaded attachment path (repeatable)",
        { type: "strings", default: [] },
      ),
      flag("--section <id>", "Create the thread in a section"),
      flag("--pinned", "Create the thread in Pinned"),
      flag(
        "--visibility <visibility>",
        "Thread visibility: visible or hidden (a child inherits its parent)",
      ),
      flag("--parent-notifications <value>", PARENT_NOTIFICATIONS_HELP),
      flag(
        "--environment-provider <id>",
        "Run on an environment provider by id (list them with `bb environment providers`)",
      ),
      flag(
        "--environment-inputs <json>",
        "JSON value for an --environment-provider that declares inputs (`bb environment providers --json` shows the schema)",
      ),
      flag("--send-at <when>", SEND_AT_HELP),
      flag("--origin-kind <kind>", "Thread origin: fork"),
      flag("--source-thread <id>", "Source thread for a fork"),
      flag(
        "--source-seq-end <seq>",
        "Fork after the source turn containing this event sequence",
      ),
    ],
    prepare: ({ options }) => ({
      ...(optionalString(options["prompt"]) === undefined
        ? {}
        : { prompt: optionalString(options["prompt"]) }),
      ...(optionalString(options["prompt-file"]) === undefined
        ? {}
        : { promptFile: optionalString(options["prompt-file"]) }),
      ...(optionalString(options["lifecycle-owner-thread"]) === undefined
        ? {}
        : {
            lifecycleOwnerThread: optionalString(
              options["lifecycle-owner-thread"],
            ),
          }),
      ...(optionalString(options["project"]) === undefined
        ? {}
        : { project: optionalString(options["project"]) }),
      ...(optionalString(options["environment"]) === undefined
        ? {}
        : { environment: optionalString(options["environment"]) }),
      ...(optionalString(options["new-environment"]) === undefined
        ? {}
        : { newEnvironment: optionalString(options["new-environment"]) }),
      ...(optionalString(options["base-branch"]) === undefined
        ? {}
        : { baseBranch: optionalString(options["base-branch"]) }),
      ...(optionalString(options["machine"]) === undefined
        ? {}
        : { machine: optionalString(options["machine"]) }),
      ...(optionalString(options["host"]) === undefined
        ? {}
        : { host: optionalString(options["host"]) }),
      ...(optionalString(options["new-machine"]) === undefined
        ? {}
        : { newMachine: optionalString(options["new-machine"]) }),
      ...(optionalString(options["machine-inputs"]) === undefined
        ? {}
        : { machineInputs: optionalString(options["machine-inputs"]) }),
      ...(optionalString(options["parent-thread"]) === undefined
        ? {}
        : { parentThread: optionalString(options["parent-thread"]) }),
      ...(options["parent-self"] === true ? { parentSelf: true } : {}),
      ...(optionalString(options["provider"]) === undefined
        ? {}
        : { provider: optionalString(options["provider"]) }),
      ...(optionalString(options["model"]) === undefined
        ? {}
        : { model: optionalString(options["model"]) }),
      ...(optionalString(options["reasoning-level"]) === undefined
        ? {}
        : { reasoningLevel: optionalString(options["reasoning-level"]) }),
      ...(optionalString(options["title"]) === undefined
        ? {}
        : { title: optionalString(options["title"]) }),
      ...(optionalString(options["service-tier"]) === undefined
        ? {}
        : { serviceTier: optionalString(options["service-tier"]) }),
      option: stringList(options["option"]),
      ...(optionalString(options["permission-mode"]) === undefined
        ? {}
        : { permissionMode: optionalString(options["permission-mode"]) }),
      ...(options["plan"] === true ? { plan: true } : {}),
      file: stringList(options["file"]),
      image: stringList(options["image"]),
      ...(optionalString(options["section"]) === undefined
        ? {}
        : { section: optionalString(options["section"]) }),
      ...(options["pinned"] === true ? { pinned: true } : {}),
      ...(optionalString(options["visibility"]) === undefined
        ? {}
        : { visibility: optionalString(options["visibility"]) }),
      ...(optionalString(options["parent-notifications"]) === undefined
        ? {}
        : {
            parentNotifications: optionalString(
              options["parent-notifications"],
            ),
          }),
      ...(optionalString(options["environment-provider"]) === undefined
        ? {}
        : {
            environmentProvider: optionalString(
              options["environment-provider"],
            ),
          }),
      ...(optionalString(options["environment-inputs"]) === undefined
        ? {}
        : { environmentInputs: optionalString(options["environment-inputs"]) }),
      ...(optionalString(options["send-at"]) === undefined
        ? {}
        : { sendAt: optionalString(options["send-at"]) }),
      ...(optionalString(options["origin-kind"]) === undefined
        ? {}
        : { originKind: optionalString(options["origin-kind"]) }),
      ...(optionalString(options["source-thread"]) === undefined
        ? {}
        : { sourceThread: optionalString(options["source-thread"]) }),
      ...(optionalString(options["source-seq-end"]) === undefined
        ? {}
        : { sourceSeqEnd: optionalString(options["source-seq-end"]) }),
    }),
    async run(opts, client) {
      const prompt = await requireTextInput({
        file: opts.promptFile,
        fileLabel: "--prompt-file",
        inline: opts.prompt,
        inlineLabel: "--prompt <prompt>",
      });
      const projectId = resolveExplicitIdFlag({
        flagName: "--project flag",
        value: opts.project,
      });
      if (!projectId) {
        throw new CliUsageError({
          code: "missing_required",
          hint: missingProjectHint(),
          message: "Missing required option --project <id>.",
        });
      }
      const environmentValue = resolveSpawnEnvironmentValue(opts.environment);
      if (
        opts.environmentInputs !== undefined &&
        !opts.environmentProvider &&
        !opts.newMachine
      ) {
        throw new Error(
          "--environment-inputs requires --environment-provider <id>.",
        );
      }
      const machineTarget = resolveMachineTargetOption(opts);
      if (machineTarget && opts.newMachine) {
        throw new Error(
          "Cannot combine --new-machine with --machine or --host.",
        );
      }
      if (opts.machineInputs !== undefined && !opts.newMachine) {
        if (!opts.environmentProvider)
          throw new Error(
            "--machine-inputs requires --new-machine <provider-id> or a composed --environment-provider.",
          );
      }
      if (
        machineTarget &&
        environmentValue &&
        !looksLikePath(environmentValue)
      ) {
        throw new Error(
          "Cannot combine --machine or --host with an existing environment ID; that environment already selects its machine.",
        );
      }
      const machineProvider = opts.newMachine
        ? (await client.call("system.machineProviders", {})).providers.find(
            (provider) => provider.id === opts.newMachine?.trim(),
          )
        : undefined;
      if (opts.newMachine && machineProvider === undefined) {
        throw new Error(
          `Unknown machine provider '${opts.newMachine.trim()}'.`,
        );
      }
      let machineInputs = parseJsonFlag(opts.machineInputs, "--machine-inputs");
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
      const selectedEnvironmentProvider = opts.environmentProvider;
      if (machineProvider && selectedEnvironmentProvider === undefined) {
        throw new Error(
          `The '${machineProvider.id}' machine provider requires an environment provider; combine --new-machine with --environment-provider <id>.`,
        );
      }
      const needsHostId =
        !opts.environmentProvider &&
        !opts.newMachine &&
        (Boolean(opts.newEnvironment) ||
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
            environmentInputs: opts.environmentInputs,
            environmentValue,
            newEnvironmentKind: opts.newEnvironment,
            baseBranch: opts.baseBranch,
            machineHostId: hostId,
            machine: newMachineSelection,
            machineInputs,
            machineInputsProvided: opts.machineInputs !== undefined,
            projectId,
            resolveDefaultHostId: resolveLocalHostId,
          })
        : buildSpawnEnvironment({
            defaultPersonalWorkspace: projectId === PERSONAL_PROJECT_ID,
            environmentValue,
            newEnvironmentKind: opts.newEnvironment,
            hostId,
            baseBranch: opts.baseBranch,
          });
      const reasoningLevel = parseReasoningLevel(opts.reasoningLevel);
      const serviceTier = parseServiceTier(opts.serviceTier);
      const sessionOptions = parseSpawnSessionOptions(opts.option ?? []);
      const permissionMode = parsePermissionMode(opts.permissionMode);
      const visibility =
        opts.visibility === undefined
          ? undefined
          : threadVisibilitySchema.parse(opts.visibility);
      const parentNotifications = parseParentNotifications(
        opts.parentNotifications,
      );
      const parentThreadId = resolveSpawnParentThreadId({
        parentSelf: opts.parentSelf,
        parentThread: opts.parentThread,
      });
      if (opts.originKind !== undefined && opts.originKind !== "fork") {
        throw new Error("--origin-kind must be fork.");
      }
      const sourceSeqEnd =
        opts.sourceSeqEnd === undefined ? undefined : Number(opts.sourceSeqEnd);
      if (
        sourceSeqEnd !== undefined &&
        (!Number.isInteger(sourceSeqEnd) || sourceSeqEnd < 0)
      ) {
        throw new Error("--source-seq-end must be a non-negative integer.");
      }
      const sendAt =
        opts.sendAt === undefined ? undefined : parseSendAt(opts.sendAt);
      const providerId = opts.provider?.trim();

      let thread: Thread;
      try {
        const input = await uploadClientAttachmentInputs({
          input: buildPromptInputs({
            message: prompt,
            ...(opts.plan === undefined ? {} : { plan: opts.plan }),
            files: opts.file ?? [],
            images: opts.image ?? [],
          }),
          resolveProjectId: async () => projectId,
          sdk: client.sdk(),
        });
        thread = await client.call("threads.create", {
          projectId,
          ...(providerId ? { providerId } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          input,
          ...(reasoningLevel ? { reasoningLevel } : {}),
          ...(opts.title ? { title: opts.title } : {}),
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
          ...(opts.lifecycleOwnerThread !== undefined
            ? { lifecycleOwnerThreadId: opts.lifecycleOwnerThread }
            : {}),
          ...(opts.section ? { sectionId: opts.section } : {}),
          ...(opts.pinned ? { pinned: true } : {}),
          ...(opts.sourceThread ? { sourceThreadId: opts.sourceThread } : {}),
          ...(sourceSeqEnd !== undefined ? { sourceSeqEnd } : {}),
          ...(sendAt !== undefined ? { sendAt } : {}),
          origin: "cli",
          startedOnBehalfOf: null,
          originKind: opts.originKind === "fork" ? "fork" : null,
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

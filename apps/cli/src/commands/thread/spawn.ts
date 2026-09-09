import { Command } from "commander";
import {
  jsonValueSchema,
  PERSONAL_PROJECT_ID,
  threadEnvVarNameSchema,
  threadEnvVarValueSchema,
  threadEnvVarsSchema,
  threadVisibilitySchema,
  type GitBranchSelection,
  type Thread,
  type JsonValue,
  type ThreadEnvVars,
} from "@bb/domain";
import type { CreateThreadEnvironmentArgs } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  resolveExplicitIdFlag,
  resolveContextThreadId,
} from "../../context-env.js";
import { resolveLocalHostId } from "../../daemon.js";
import {
  resolveMachineHostId,
  resolveMachineTargetOption,
} from "../machine.js";
import {
  outputJson,
  parseReasoningLevel,
  prependErrorContext,
} from "../helpers.js";
import {
  parsePermissionMode,
  buildPromptInputs,
  collectOption,
  PERMISSION_MODE_HELP,
  PLAN_HELP,
  parseServiceTier,
} from "./helpers.js";
import { SEND_AT_HELP, parseSendAt } from "./send-time.js";

const PROVIDER_HELP =
  "Provider ID for the thread. Omit to use the project's remembered provider choice";

interface ThreadSpawnCommandOptions {
  prompt: string;
  json?: boolean;
  project?: string;
  environment?: string;
  env?: string[];
  newEnvironment?: string;
  environmentProvider?: string;
  environmentInputs?: string;
  baseBranch?: string;
  parentThread?: string;
  provider?: string;
  model?: string;
  reasoningLevel?: string;
  title?: string;
  serviceTier?: string;
  permissionMode?: string;
  plan?: boolean;
  parentSelf?: boolean;
  machine?: string;
  host?: string;
  file?: string[];
  image?: string[];
  section?: string;
  originKind?: string;
  sourceThread?: string;
  sourceSeqEnd?: string;
  visibility?: string;
  sendAt?: string;
}

export function looksLikePath(value: string): boolean {
  return value.includes("/") || value.startsWith(".") || value.startsWith("~");
}

export function parseThreadEnvVars(
  values: readonly string[] | undefined,
): ThreadEnvVars | undefined {
  if (values === undefined || values.length === 0) return undefined;
  const entries: [string, string][] = [];
  const names = new Set<string>();
  for (const entry of values) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex === -1) {
      throw new Error("Invalid --env entry. Expected KEY=VALUE.");
    }
    const name = entry.slice(0, separatorIndex);
    const value = entry.slice(separatorIndex + 1);
    const parsedName = threadEnvVarNameSchema.safeParse(name);
    if (!parsedName.success) {
      throw new Error(
        `Invalid --env variable name '${name}': ${parsedName.error.issues[0]?.message ?? "is invalid"}.`,
      );
    }
    if (names.has(parsedName.data)) {
      throw new Error(`Duplicate --env variable '${parsedName.data}'.`);
    }
    const parsedValue = threadEnvVarValueSchema.safeParse(value);
    if (!parsedValue.success) {
      throw new Error(
        `Invalid --env value for '${parsedName.data}': ${parsedValue.error.issues[0]?.message ?? "is invalid"}.`,
      );
    }
    names.add(parsedName.data);
    entries.push([parsedName.data, parsedValue.data]);
  }
  const parsed = threadEnvVarsSchema.safeParse(Object.fromEntries(entries));
  if (!parsed.success) {
    throw new Error(
      `Invalid --env values: ${parsed.error.issues[0]?.message ?? "the environment is invalid"}.`,
    );
  }
  return parsed.data;
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

function parseEnvironmentInputs(
  flagValue: string | undefined,
): JsonValue | null {
  if (flagValue === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(flagValue);
  } catch {
    throw new Error("--environment-inputs must be valid JSON.");
  }
  return jsonValueSchema.parse(parsed);
}

async function buildProviderSpawnEnvironment(args: {
  serverUrl: string;
  environmentProvider: string;
  environmentInputs: string | undefined;
  environmentValue: string | undefined;
  newEnvironmentKind: string | undefined;
  baseBranch: string | undefined;
  machineHostId: string | null;
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
  const providers = await createCliBbSdk(
    args.serverUrl,
  ).environments.listProviders({ projectId: args.projectId });
  const match = providers.find((provider) => provider.id === requested);
  if (match === undefined) {
    const available = providers.map((provider) => provider.id).join(", ");
    throw new Error(
      `Unknown environment provider '${requested}'.${available ? ` Available: ${available}.` : ""}`,
    );
  }
  let inputs = parseEnvironmentInputs(args.environmentInputs);
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
  const machine = {
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

export function registerSpawnCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("spawn")
    .description(
      "Spawn a new thread; omitted execution flags use remembered project defaults, then the target provider catalog default",
    )
    .requiredOption("--prompt <prompt>", "Initial prompt for the thread")
    .option("--json", "Print machine-readable JSON output")
    .requiredOption("--project <id>", "Project ID")
    .option(
      "--environment <id-or-path>",
      "Existing environment ID or unmanaged workspace path",
    )
    .option(
      "--env <KEY=VALUE>",
      "Set a per-thread environment variable (repeatable)",
      collectOption,
      [],
    )
    .option(
      "--new-environment <kind>",
      "Create a fresh environment of the given kind (personal or worktree)",
    )
    .option(
      "--base-branch <branch>",
      "Exact Git ref; omit for bb's project default (use origin/<branch> for a remote ref)",
    )
    .option(
      "--machine <id-or-name>",
      "Execution machine ID or unambiguous name",
    )
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--parent-thread <id>", "Parent thread ID for worker thread links")
    .option("--parent-self", "Parent the new thread to BB_THREAD_ID")
    .option("--provider <id>", PROVIDER_HELP)
    .option(
      "--model <model>",
      "Model ID for the thread. Omit to use the project's remembered default for the resolved provider",
    )
    .option(
      "--reasoning-level <level>",
      "Reasoning level: low, medium, high, xhigh, max (provider-dependent)",
    )
    .option("--title <title>", "Thread title")
    .option("--service-tier <tier>", "Service tier: fast or default")
    .option("--permission-mode <mode>", PERMISSION_MODE_HELP)
    .option("--plan", PLAN_HELP)
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
    .option("--section <id>", "Create the thread in a section")
    .option(
      "--visibility <visibility>",
      "Thread visibility: visible or hidden (a child inherits its parent)",
    )
    .option(
      "--environment-provider <id>",
      "Run on an environment provider by id (list them with `bb environment providers`)",
    )
    .option(
      "--environment-inputs <json>",
      "JSON value for an --environment-provider that declares inputs (`bb environment providers --json` shows the schema)",
    )
    .option("--send-at <when>", SEND_AT_HELP)
    .option("--origin-kind <kind>", "Thread origin: fork")
    .option("--source-thread <id>", "Source thread for a fork")
    .option(
      "--source-seq-end <seq>",
      "Fork after the source turn containing this event sequence",
    )
    .action(
      action(async (opts: ThreadSpawnCommandOptions) => {
        const projectId = resolveExplicitIdFlag({
          flagName: "--project flag",
          value: opts.project,
        });
        if (!projectId) {
          throw new Error("Missing required option --project <id>.");
        }
        const environmentValue = resolveSpawnEnvironmentValue(opts.environment);
        if (opts.environmentInputs !== undefined && !opts.environmentProvider) {
          throw new Error(
            "--environment-inputs requires --environment-provider <id>.",
          );
        }
        const machineTarget = resolveMachineTargetOption(opts);
        if (
          machineTarget &&
          environmentValue &&
          !looksLikePath(environmentValue)
        ) {
          throw new Error(
            "Cannot combine --machine or --host with an existing environment ID; that environment already selects its machine.",
          );
        }
        const selectedEnvironmentProvider = opts.environmentProvider;
        const needsHostId =
          !opts.environmentProvider &&
          (Boolean(opts.newEnvironment) ||
            (environmentValue !== undefined &&
              looksLikePath(environmentValue)));
        const hostId = machineTarget
          ? await resolveMachineHostId({
              serverUrl: getUrl(),
              target: machineTarget,
            })
          : needsHostId
            ? await resolveLocalHostId()
            : null;
        const environment = selectedEnvironmentProvider
          ? await buildProviderSpawnEnvironment({
              serverUrl: getUrl(),
              environmentProvider: selectedEnvironmentProvider,
              environmentInputs: opts.environmentInputs,
              environmentValue,
              newEnvironmentKind: opts.newEnvironment,
              baseBranch: opts.baseBranch,
              machineHostId: hostId,
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
        const permissionMode = parsePermissionMode(opts.permissionMode);
        const visibility =
          opts.visibility === undefined
            ? undefined
            : threadVisibilitySchema.parse(opts.visibility);
        const parentThreadId = resolveSpawnParentThreadId({
          parentSelf: opts.parentSelf,
          parentThread: opts.parentThread,
        });
        if (opts.originKind !== undefined && opts.originKind !== "fork") {
          throw new Error("--origin-kind must be fork.");
        }
        const sourceSeqEnd =
          opts.sourceSeqEnd === undefined
            ? undefined
            : Number(opts.sourceSeqEnd);
        if (
          sourceSeqEnd !== undefined &&
          (!Number.isInteger(sourceSeqEnd) || sourceSeqEnd < 0)
        ) {
          throw new Error("--source-seq-end must be a non-negative integer.");
        }
        const sendAt =
          opts.sendAt === undefined ? undefined : parseSendAt(opts.sendAt);
        const providerId = opts.provider?.trim();
        const envVars = parseThreadEnvVars(opts.env);

        let thread: Thread;
        try {
          const sdk = createCliBbSdk(getUrl());
          thread = await sdk.threads.spawn({
            origin: "cli",
            projectId,
            ...(providerId ? { providerId } : {}),
            ...(envVars ? { envVars } : {}),
            ...(opts.model ? { model: opts.model } : {}),
            input: buildPromptInputs({
              message: opts.prompt,
              plan: opts.plan,
              files: opts.file,
              images: opts.image,
            }),
            ...(reasoningLevel ? { reasoningLevel } : {}),
            ...(opts.title ? { title: opts.title } : {}),
            ...(serviceTier ? { serviceTier } : {}),
            ...(permissionMode ? { permissionMode } : {}),
            ...(visibility ? { visibility } : {}),
            environment,
            startedOnBehalfOf: null,
            originKind: opts.originKind ?? null,
            ...(parentThreadId ? { parentThreadId } : {}),
            ...(opts.section ? { sectionId: opts.section } : {}),
            ...(opts.sourceThread ? { sourceThreadId: opts.sourceThread } : {}),
            ...(sourceSeqEnd !== undefined ? { sourceSeqEnd } : {}),
            ...(sendAt !== undefined ? { sendAt } : {}),
          });
        } catch (err: unknown) {
          throw prependErrorContext("Failed to create thread", err);
        }

        if (outputJson(opts, thread)) return;
        console.log(`Thread spawned: ${thread.id}`);
        if (sendAt !== undefined) {
          console.log(
            `First message scheduled for ${new Date(sendAt).toLocaleString()}; the thread stays pending until then.`,
          );
        }
        // A hidden child reports to its parent too, so the promise follows the
        // parent link alone.
        if (
          thread.parentThreadId &&
          thread.parentThreadId === resolveContextThreadId()
        ) {
          console.log("You will be notified when this thread is done.");
        }
        printThread(thread);
      }),
    );
}

function printThread(thread: Thread): void {
  console.log("");
  console.log(`  ID:       ${thread.id}`);
  console.log(
    `  Project:  ${thread.projectId === PERSONAL_PROJECT_ID ? "-" : thread.projectId}`,
  );
  console.log(`  Status:   ${thread.status}`);
  if (thread.visibility === "hidden") {
    console.log("  Visibility: hidden");
  }
  if (thread.archivedAt !== null) {
    console.log(`  Archived: ${new Date(thread.archivedAt).toLocaleString()}`);
  }
  console.log(`  Created:  ${new Date(thread.createdAt).toLocaleString()}`);
  console.log(`  Updated:  ${new Date(thread.updatedAt).toLocaleString()}`);
  console.log("");
}

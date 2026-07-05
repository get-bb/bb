import { Command } from "commander";
import { PERSONAL_PROJECT_ID, type Thread } from "@bb/domain";
import type { BaseBranchSpec, EnvironmentArgs } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  resolveExplicitIdFlag,
  resolveContextThreadId,
} from "../../context-env.js";
import { resolveLocalHostId } from "../../daemon.js";
import {
  outputJson,
  parseReasoningLevel,
  prependErrorContext,
} from "../helpers.js";
import {
  parsePermissionMode,
  PERMISSION_MODE_HELP,
  parseServiceTier,
  statusText,
} from "./helpers.js";

interface ThreadSpawnCommandOptions {
  prompt: string;
  json?: boolean;
  project?: string;
  environment?: string;
  newEnvironment?: string;
  baseBranch?: string;
  host?: string;
  parentThread?: string;
  provider?: string;
  model?: string;
  reasoningLevel?: string;
  title?: string;
  serviceTier?: string;
  permissionMode?: string;
  parentSelf?: boolean;
}

export function looksLikePath(value: string): boolean {
  return value.includes("/") || value.startsWith(".") || value.startsWith("~");
}

export function requireHostId(hostId: string | null): string {
  if (!hostId) {
    throw new Error("Cannot reach local host daemon. Is it running?");
  }
  return hostId;
}

function resolveSpawnEnvironmentValue(flagValue?: string): string | undefined {
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
}): EnvironmentArgs {
  const environmentValue = args.environmentValue?.trim();
  const newEnvironmentKind = args.newEnvironmentKind?.trim();
  const trimmedBaseBranch = args.baseBranch?.trim();
  const baseBranch: BaseBranchSpec = trimmedBaseBranch
    ? { kind: "named", name: trimmedBaseBranch }
    : { kind: "default" };

  if (environmentValue && newEnvironmentKind) {
    throw new Error("Cannot combine --environment with --new-environment.");
  }
  if (newEnvironmentKind) {
    if (newEnvironmentKind === "worktree") {
      return {
        type: "host",
        hostId: requireHostId(args.hostId),
        workspace: { type: "managed-worktree", baseBranch },
      };
    }
    throw new Error(
      `Unknown environment kind '${newEnvironmentKind}'. Supported: worktree.`,
    );
  }
  if (!environmentValue) {
    if (args.defaultPersonalWorkspace) {
      return {
        type: "host",
        ...(args.hostId ? { hostId: args.hostId } : {}),
        workspace: { type: "personal" },
      };
    }
    return {
      type: "host",
      hostId: requireHostId(args.hostId),
      workspace: { type: "unmanaged", path: null },
    };
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

export function registerSpawnCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("spawn")
    .description(
      "Spawn a new thread for a project; omitted provider and execution flags inherit remembered project defaults",
    )
    .requiredOption("--prompt <prompt>", "Initial prompt for the thread")
    .option("--json", "Print machine-readable JSON output")
    .requiredOption(
      "--project <id>",
      "Project ID",
    )
    .option(
      "--environment <id-or-path>",
      "Existing environment ID or unmanaged workspace path",
    )
    .option(
      "--new-environment <kind>",
      "Create a new managed environment of the given kind (worktree)",
    )
    .option(
      "--base-branch <branch>",
      "Base branch for new managed worktrees. Omit to let bb choose the project's default worktree base.",
    )
    .option(
      "--host <id>",
      "Target host ID to run on (e.g. a second connected machine). Omit to use the local primary host.",
    )
    .option(
      "--parent-thread <id>",
      "Parent thread ID for worker thread links",
    )
    .option("--parent-self", "Parent the new thread to BB_THREAD_ID")
    .option(
      "--provider <id>",
      "Provider ID for the thread. Omit to use the project's remembered provider choice",
    )
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
    .action(
      action(async (opts: ThreadSpawnCommandOptions) => {
        const projectId = resolveExplicitIdFlag({
          flagName: "--project flag",
          value: opts.project,
        });
        if (!projectId) {
          throw new Error("Missing required option --project <id>.");
        }
        const environmentValue = resolveSpawnEnvironmentValue(
          opts.environment,
        );
        const defaultPersonalWorkspace =
          projectId === PERSONAL_PROJECT_ID &&
          !environmentValue &&
          !opts.newEnvironment;
        const needsHostId =
          Boolean(opts.newEnvironment) ||
          (!defaultPersonalWorkspace &&
            (!environmentValue || looksLikePath(environmentValue)));
        // An explicit --host targets a specific connected host (e.g. a second
        // machine); otherwise fall back to the local primary host when one is
        // needed. The server validates the host is a usable connected host.
        const explicitHostId = opts.host?.trim() || null;
        const hostId =
          explicitHostId ?? (needsHostId ? await resolveLocalHostId() : null);
        const environment = buildSpawnEnvironment({
          defaultPersonalWorkspace,
          environmentValue,
          newEnvironmentKind: opts.newEnvironment,
          hostId,
          baseBranch: opts.baseBranch,
        });
        const reasoningLevel = parseReasoningLevel(opts.reasoningLevel);
        const serviceTier = parseServiceTier(opts.serviceTier);
        const permissionMode = parsePermissionMode(opts.permissionMode);
        const parentThreadId = resolveSpawnParentThreadId({
          parentSelf: opts.parentSelf,
          parentThread: opts.parentThread,
        });

        let thread: Thread;
        try {
          const sdk = createCliBbSdk(getUrl());
          thread = await sdk.threads.spawn({
            origin: "cli",
            projectId,
            ...(opts.provider ? { providerId: opts.provider } : {}),
            ...(opts.model ? { model: opts.model } : {}),
            input: [{ type: "text", text: opts.prompt, mentions: [] }],
            ...(reasoningLevel ? { reasoningLevel } : {}),
            ...(opts.title ? { title: opts.title } : {}),
            ...(serviceTier ? { serviceTier } : {}),
            ...(permissionMode ? { permissionMode } : {}),
            environment,
            // The typed $post client types this body against the schema's
            // output shape, where startedOnBehalfOf/originKind/childOrigin
            // (`.default(null)`) are required — so a normal spawn passes the
            // explicit null the server would otherwise fill. (A fork/side-chat
            // sets these; the CLI never does. z.input would re-optionalize the
            // SDK arg type but the underlying $post still requires them, so the
            // null lives here.)
            startedOnBehalfOf: null,
            originKind: null,
            childOrigin: null,
            ...(parentThreadId ? { parentThreadId } : {}),
          });
        } catch (err: unknown) {
          throw prependErrorContext("Failed to create thread", err);
        }

        if (outputJson(opts, thread)) return;
        console.log(`Thread spawned: ${thread.id}`);
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
  console.log(`  Status:   ${statusText(thread.status)}`);
  if (thread.archivedAt !== null) {
    console.log(`  Archived: ${new Date(thread.archivedAt).toLocaleString()}`);
  }
  console.log(`  Created:  ${new Date(thread.createdAt).toLocaleString()}`);
  console.log(`  Updated:  ${new Date(thread.updatedAt).toLocaleString()}`);
  console.log("");
}

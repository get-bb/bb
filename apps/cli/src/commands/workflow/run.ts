import { randomUUID } from "node:crypto";
import { Command } from "commander";
import {
  jsonValueSchema,
  reasoningLevelSchema,
  reasoningLevelValues,
  type JsonValue,
  type ReasoningLevel,
} from "@bb/domain";
import type {
  CreateWorkflowRunSource,
  WorkflowRunResponse,
} from "@bb/server-contract";
import { BbHttpError } from "@bb/sdk/node";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { requireProjectId, resolveThreadId } from "../../context-env.js";
import { fetchLocalHostId } from "../../daemon.js";
import { outputJson, prependErrorContext } from "../helpers.js";
import { looksLikePath, requireHostId } from "../thread/spawn.js";
import {
  DEFAULT_WORKFLOW_WAIT_TIMEOUT_SECONDS,
  parseWorkflowWaitTimeoutSeconds,
  DEFAULT_WORKFLOW_WAIT_POLL_INTERVAL_MS,
  reportSettledWorkflowRun,
  waitForSettledWorkflowRun,
  workflowRunDeepLink,
} from "./helpers.js";
import { readValidatedWorkflowFile } from "./validate.js";

interface WorkflowRunCommandOptions {
  json?: boolean;
  project?: string;
  args?: string;
  host?: string;
  effort?: string;
  wait?: boolean;
  timeout?: string;
  contextAnchorThread?: boolean;
}

function parseWorkflowEffort(value: string): ReasoningLevel {
  const parsed = reasoningLevelSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid --effort "${value}". Expected one of: ${reasoningLevelValues.join(", ")}.`,
    );
  }
  return parsed.data;
}

/**
 * A positional `<workflow>` is a file (inline launch) when it is path-like or
 * has a .js suffix; otherwise it is a registry name resolved on the host
 * (project > user > builtin).
 */
function isWorkflowFileArgument(value: string): boolean {
  return looksLikePath(value) || value.endsWith(".js");
}

function parseWorkflowArgs(value: string): JsonValue {
  try {
    return jsonValueSchema.parse(JSON.parse(value));
  } catch (err: unknown) {
    throw prependErrorContext("Invalid --args JSON", err);
  }
}

interface LaunchErrorContext {
  anchoredFromEnv: boolean;
  hostExplicit: boolean;
  /** Null = no host sent (anchored launch inheriting the thread environment). */
  hostId: string | null;
}

/**
 * Turn the launch failures the CLI itself caused into actionable errors:
 * the 404 for a host without a project source names the host the CLI chose
 * (the local daemon's, unless --host was passed), the anchored-launch
 * environment 409s name the inherited thread environment and the --host
 * escape hatch, and the cross-project anchor 400 names the implicit
 * BB_THREAD_ID anchoring and its opt-out flag. Everything else passes
 * through for the generic launch-failure prefix.
 */
function mapWorkflowLaunchError(
  err: unknown,
  context: LaunchErrorContext,
): unknown {
  if (!(err instanceof BbHttpError)) return err;
  if (
    context.hostId !== null &&
    err.status === 404 &&
    err.message.includes("no local-path source")
  ) {
    const hostNote = context.hostExplicit
      ? `host ${context.hostId}`
      : `host ${context.hostId} (the local daemon's host, chosen by default)`;
    return new Error(
      `Project has no source on ${hostNote}. Pass --host <id> for the host ` +
        "that has this project's checkout — 'bb workflow list' shows " +
        "workflows from the project's default source.",
    );
  }
  if (
    context.hostId === null &&
    (err.code === "thread_environment_unavailable" ||
      err.code === "environment_not_ready")
  ) {
    return new Error(
      "Anchored launches inherit the thread environment (from BB_THREAD_ID), " +
        "but this thread's environment is not usable. Pass --host <id> to " +
        "launch against the project's source on that host, or " +
        "--no-context-anchor-thread to launch detached.",
    );
  }
  if (
    context.anchoredFromEnv &&
    err.status === 400 &&
    err.message.includes("Anchor thread belongs to a different project")
  ) {
    return new Error(
      "Anchor thread (from BB_THREAD_ID) belongs to a different project " +
        "than --project. Pass --no-context-anchor-thread to launch detached, " +
        "or drop --project to use the thread's project.",
    );
  }
  return err;
}

export function registerWorkflowRunCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("run <workflow>")
    .description(
      "Launch a workflow run from a registry name or a workflow file (inline); prints the run id and live link immediately",
    )
    .option("--json", "Print machine-readable JSON output")
    .option("--project <id>", "Project ID (defaults to BB_PROJECT_ID)")
    .option("--args <json>", "Workflow args as a JSON value")
    .option("--host <id>", "Host ID (defaults to the local host daemon)")
    .option(
      "--effort <level>",
      `Reasoning effort override (${reasoningLevelValues.join("|")}; defaults to server policy)`,
    )
    .option("--wait", "Block until the run settles and print its result")
    .option(
      "--timeout <seconds>",
      `Wait timeout in seconds, with --wait (default: ${DEFAULT_WORKFLOW_WAIT_TIMEOUT_SECONDS})`,
    )
    .option(
      "--no-context-anchor-thread",
      "Do not anchor the run to BB_THREAD_ID",
    )
    .action(
      action(async (workflow: string, opts: WorkflowRunCommandOptions) => {
        if (opts.timeout !== undefined && !opts.wait) {
          throw new Error("--timeout requires --wait.");
        }

        const projectId = requireProjectId(opts.project);
        // File arguments pre-validate locally with the exact gate the server
        // applies at launch (CLI-accepted == server-accepted by construction),
        // so determinism/meta failures report precise findings offline
        // instead of a generic server 422.
        const source: CreateWorkflowRunSource = isWorkflowFileArgument(workflow)
          ? {
              type: "inline",
              script: (await readValidatedWorkflowFile(workflow)).content,
            }
          : { type: "named", name: workflow };
        const workflowArgs =
          opts.args !== undefined ? parseWorkflowArgs(opts.args) : undefined;
        const effort =
          opts.effort !== undefined
            ? parseWorkflowEffort(opts.effort)
            : undefined;
        const anchorThreadId =
          opts.contextAnchorThread === false ? undefined : resolveThreadId();
        // Anchored launches without --host send no hostId at all: the server
        // inherits {hostId, workspacePath} from the anchor thread's
        // environment (one default, owned server-side). Unanchored launches
        // keep the local-daemon default, like `bb thread spawn`.
        const hostId =
          opts.host !== undefined
            ? requireHostId(opts.host)
            : anchorThreadId !== undefined
              ? null
              : requireHostId(await fetchLocalHostId());
        if (anchorThreadId !== undefined && !opts.json) {
          // The anchor can only come from the environment (there is no
          // --thread flag), so announce it like other env-derived context.
          console.error(
            `Anchored to thread ${anchorThreadId} (from BB_THREAD_ID; --no-context-anchor-thread to detach)`,
          );
        }

        const sdk = createCliBbSdk(getUrl());
        let run: WorkflowRunResponse;
        try {
          run = await sdk.workflows.run({
            projectId,
            source,
            // Crash-retry idempotency: a retried/replayed launch with this key
            // converges on one run instead of double-launching.
            clientRequestId: randomUUID(),
            ...(hostId !== null ? { hostId } : {}),
            ...(anchorThreadId !== undefined ? { anchorThreadId } : {}),
            ...(workflowArgs !== undefined ? { args: workflowArgs } : {}),
            ...(effort !== undefined ? { effort } : {}),
          });
        } catch (err: unknown) {
          throw prependErrorContext(
            "Failed to launch workflow run",
            mapWorkflowLaunchError(err, {
              anchoredFromEnv: anchorThreadId !== undefined,
              hostExplicit: opts.host !== undefined,
              hostId,
            }),
          );
        }

        // Live link first, result later: the id + deep link print before any
        // waiting so detached callers can re-attach with `bb workflow wait`.
        if (!opts.json) {
          console.log(`Workflow run started: ${run.id}`);
          console.log(`Live: ${workflowRunDeepLink(getUrl(), run.id)}`);
          if (!opts.wait) {
            console.log(`Re-attach: bb workflow wait ${run.id}`);
          }
        }

        if (!opts.wait) {
          outputJson(opts, run);
          return;
        }

        const settled = await waitForSettledWorkflowRun({
          sdk,
          runId: run.id,
          timeoutSeconds: parseWorkflowWaitTimeoutSeconds(opts.timeout),
          pollIntervalMs: DEFAULT_WORKFLOW_WAIT_POLL_INTERVAL_MS,
        });
        reportSettledWorkflowRun(opts, settled);
      }),
    );
}

import {
  defineRpcContract,
  type BbPluginApi,
  type JsonValue,
} from "@get-bb/plugin-sdk";
import type { PluginEnvironmentProviderProgress } from "@get-bb/plugin-sdk/environment-provider";
import { reportHostProgress } from "bb-environment-provider-host/progress";
import { z } from "zod";
import {
  discoveredWorktreeSchema,
  worktreeBaseBranchSchema,
  worktreeHostContract,
  worktreeHostSignals,
} from "./contract.js";
import { GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";

const CREATE_TIMEOUT_MS = 15 * 60 * 1000;
const REMOVE_TIMEOUT_MS = 15 * 60 * 1000;

export const worktreeInputsSchema = z
  .union([
    z
      .object({
        kind: z.literal("existing"),
        path: z.string().min(1),
      })
      .strict(),
    z
      .object({
        branch: worktreeBaseBranchSchema.default({ kind: "default" }),
      })
      .strict(),
  ])
  .default({ branch: { kind: "default" } });
export type WorktreeInputs = z.infer<typeof worktreeInputsSchema>;

export const worktreeRpcContract = defineRpcContract({
  listExistingWorktrees: {
    input: z
      .object({
        projectId: z.string().min(1),
        hostId: z.string().min(1),
      })
      .strict(),
    output: z.object({ worktrees: z.array(discoveredWorktreeSchema) }).strict(),
  },
});

const ADOPTED_RESOURCE = { adopted: true } as const;

function isAdoptedResource(resource: JsonValue | null): boolean {
  return (
    typeof resource === "object" &&
    resource !== null &&
    !Array.isArray(resource) &&
    resource.adopted === true
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function worktreePlugin(bb: BbPluginApi): Promise<void> {
  const host = bb.hosts.experimental_client({
    contract: worktreeHostContract,
    experimental_signals: worktreeHostSignals,
  });
  const reports = new Map<string, PluginEnvironmentProviderProgress>();

  host.experimental_onSignal("progress", (event) => {
    const report = reports.get(event.payload.operationId);
    if (report !== undefined) reportHostProgress(report, event.payload);
  });

  bb.experimental_environments.register({
    id: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
    displayName: "Worktree",
    description: "Create an isolated Git worktree for your changes.",
    icon: "FolderGit",
    requires: { gitCheckout: true },
    inputs: worktreeInputsSchema,
    policy: { pathKeys: "per-attempt" },
    async create(context) {
      const hostId = context.host.id;
      if ("kind" in context.inputs) {
        const resolved = await host.call(
          "resolveExistingWorktree",
          {
            sourcePath: context.projectCheckout.path,
            path: context.inputs.path,
          },
          { hostId, signal: context.signal, timeoutMs: CREATE_TIMEOUT_MS },
        );
        if (resolved.status === "failed") {
          return { status: "failed", message: resolved.message };
        }
        if (!(await context.experimental_claimPath(resolved.path))) {
          return {
            status: "failed",
            message: `${resolved.path} is already in use by another environment.`,
          };
        }
        return {
          status: "created",
          path: resolved.path,
          ownsPath: false,
          resource: ADOPTED_RESOURCE,
        };
      }
      const operationId = `create#${context.pathKey}#${context.attempt}`;
      reports.set(operationId, context.report);
      try {
        const result = await host.call(
          "create",
          {
            operationId,
            sourcePath: context.projectCheckout.path,
            pathKey: context.pathKey,
            branchName: context.rebuild
              ? (context.previous?.environment.branchName ??
                context.suggestedBranchName)
              : context.suggestedBranchName,
            baseBranch: context.inputs.branch,
            branchMode: context.rebuild ? "reuse-existing" : "reset",
          },
          { hostId, signal: context.signal, timeoutMs: CREATE_TIMEOUT_MS },
        );
        if (result.status === "failed") {
          return {
            status: "failed",

            message: result.message,
          };
        }
        return {
          status: "created",
          path: result.path,
          ownsPath: true,
          ...(result.baseBranch === null
            ? {}
            : { mergeBaseBranch: result.baseBranch }),
        };
      } catch (error) {
        if (context.signal.aborted) throw error;
        return {
          status: "failed",

          message: errorMessage(error),
        };
      } finally {
        reports.delete(operationId);
      }
    },
    async remove(context) {
      if (isAdoptedResource(context.resource)) {
        return { status: "removed" };
      }
      if (context.hostId === null) {
        return { status: "failed", message: "The worktree machine is unknown" };
      }
      const operationId = `remove#${context.pathKey}#${context.attempt}`;
      reports.set(operationId, context.report);
      try {
        const result = await host.call(
          "remove",
          {
            operationId,
            pathKey: context.pathKey,
            path: context.path,
          },
          {
            hostId: context.hostId,
            signal: context.signal,
            timeoutMs: REMOVE_TIMEOUT_MS,
          },
        );
        return result;
      } catch (error) {
        if (context.signal.aborted) throw error;
        return { status: "failed", message: errorMessage(error) };
      } finally {
        reports.delete(operationId);
      }
    },
  });

  bb.rpc.register(worktreeRpcContract, {
    async listExistingWorktrees({ projectId, hostId }) {
      const project = await bb.sdk.projects.get({ projectId });
      const source = project.sources.find(
        (candidate) =>
          candidate.hostId === hostId && candidate.type === "local_path",
      );
      if (source === undefined) return { worktrees: [] };
      return host.call(
        "listWorktrees",
        { sourcePath: source.path },
        { hostId },
      );
    },
  });
}

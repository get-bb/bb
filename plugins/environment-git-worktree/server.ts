import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
  type JsonValue,
} from "@get-bb/plugin-sdk";
import type {
  PluginEnvironmentProviderCreateContext,
  PluginEnvironmentProviderCreateResult,
  PluginEnvironmentProviderProgress,
} from "@get-bb/plugin-sdk/environment-provider";
import { reportHostProgress } from "bb-environment-provider-host/progress";
import { z } from "zod";
import {
  MAX_POOL_SIZE,
  discoveredWorktreeSchema,
  ownedBranchSchema,
  worktreeBaseBranchSchema,
  worktreeHostContract,
  worktreeHostSignals,
  type CreatedFolderWorktree,
  type WorktreeBaseBranch,
} from "./contract.js";
import { GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";
import {
  createWarmPools,
  warmPoolStatusSchema,
  type WarmHandOff,
  type WarmPoolStatus,
} from "./warm-pools.js";

const CREATE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_FOLDERS = 64;
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
        folders: z.array(z.string().min(1)).max(MAX_FOLDERS).default([]),
      })
      .strict(),
  ])
  .default({ branch: { kind: "default" }, folders: [] });
export type WorktreeInputs = z.infer<typeof worktreeInputsSchema>;
type WorktreeCreateContext = PluginEnvironmentProviderCreateContext<
  { gitCheckout: true },
  typeof worktreeInputsSchema
>;
type WorktreeOperation = Pick<
  WorktreeCreateContext,
  "attempt" | "host" | "pathKey" | "projectCheckout" | "report" | "signal"
>;
type OwnedBranch = z.infer<typeof ownedBranchSchema>;
type CreatedResult = Extract<
  PluginEnvironmentProviderCreateResult,
  { status: "created" }
>;

export const worktreeRpcContract = defineRpcContract({
  defaultBaseBranch: {
    input: z
      .object({
        projectId: z.string().min(1),
        hostId: z.string().min(1).nullable(),
      })
      .strict(),
    output: z.object({ branch: z.string().min(1).nullable() }).strict(),
  },
  listBranchableFolders: {
    input: z
      .object({
        projectId: z.string().min(1),
        hostId: z.string().min(1),
      })
      .strict(),
    output: z.object({ folders: z.array(z.string().min(1)) }).strict(),
  },
  listExistingWorktrees: {
    input: z
      .object({
        projectId: z.string().min(1),
        hostId: z.string().min(1),
      })
      .strict(),
    output: z.object({ worktrees: z.array(discoveredWorktreeSchema) }).strict(),
  },
  warmPoolStatus: {
    input: z.object({}).strict(),
    output: warmPoolStatusSchema,
  },
  setWarmPoolSize: {
    input: z
      .object({
        projectId: z.string().min(1),
        size: z.number().int().min(0).max(MAX_POOL_SIZE),
      })
      .strict(),
    output: warmPoolStatusSchema,
  },
  setWarmPoolHostSize: {
    input: z
      .object({
        projectId: z.string().min(1),
        hostId: z.string().min(1),
        size: z.number().int().min(0).max(MAX_POOL_SIZE).nullable(),
      })
      .strict(),
    output: warmPoolStatusSchema,
  },
  setWarmPoolFolders: {
    input: z
      .object({
        projectId: z.string().min(1),
        hostId: z.string().min(1),
        folders: z.array(z.string().min(1)).max(MAX_FOLDERS),
      })
      .strict(),
    output: warmPoolStatusSchema,
  },
});

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

function formatWarmPoolStatus(status: WarmPoolStatus): string {
  const enabled = status.pools.filter((pool) =>
    pool.checkouts.some((checkout) => checkout.size > 0),
  );
  if (enabled.length === 0) {
    return "No project keeps warm worktrees. Enable one with `bb worktree pool set <project-id> <size>`.";
  }
  return enabled
    .flatMap((pool) => [
      `${pool.projectName} (${pool.projectId}): ${pool.size} warm worktree${pool.size === 1 ? "" : "s"} per machine, ${pool.handedOff} handed off, ${pool.missed} missed since the server started`,
      ...pool.checkouts.flatMap((checkout) => [
        `  ${checkout.hostName} (${checkout.hostId}) ${checkout.path}: keeps ${checkout.size}${
          checkout.hostSize === null ? "" : " (set for this machine)"
        }, ${checkout.ready} ready, ${checkout.preparing} being set up${
          checkout.base === null ? "" : ` on ${checkout.base}`
        }`,
        ...(checkout.folders.length === 0
          ? []
          : [`    Folder worktrees: ${checkout.folders.join(", ")}`]),
        ...(checkout.lastError === null
          ? []
          : [`    Problem: ${checkout.lastError}`]),
      ]),
    ])
    .join("\n");
}

const ADOPTED_RESOURCE = { adopted: true } as const;

const worktreeResourceSchema = z.union([
  z.object({ adopted: z.literal(true) }).strict(),
  z
    .object({
      ownedBranch: ownedBranchSchema.nullable(),
      folderBranches: z.array(ownedBranchSchema).default([]),
    })
    .strict(),
]);
type WorktreeResource = z.infer<typeof worktreeResourceSchema>;

function parseWorktreeResource(
  resource: JsonValue | null,
): WorktreeResource | null {
  const parsed = worktreeResourceSchema.safeParse(resource);
  return parsed.success ? parsed.data : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function trimTrailingSeparators(folderPath: string): string {
  return folderPath.replace(/(?<=.)[\\/]+$/u, "");
}

function folderBranchesOf(
  folders: readonly CreatedFolderWorktree[],
  branchName: string,
): OwnedBranch[] {
  return folders.map((folder) => ({
    name: branchName,
    repositoryPath: folder.sourcePath,
    baseBranch: folder.baseBranch,
  }));
}

function folderAdditionalPaths(
  folders: readonly CreatedFolderWorktree[],
): { path: string; replaces: string }[] {
  return folders.map((folder) => ({
    path: folder.path,
    replaces: folder.sourcePath,
  }));
}

function folderLabel(folderPath: string): string {
  return folderPath.split(/[\\/]/u).filter(Boolean).at(-1) ?? folderPath;
}

function labelledReport(
  report: PluginEnvironmentProviderProgress,
  label: string,
): PluginEnvironmentProviderProgress {
  return {
    step: (text) => report.step(`${label}: ${text}`),
    log: (text) => report.log(`${label}: ${text}`),
  };
}

function warmFolderWorktrees(warm: WarmHandOff): CreatedFolderWorktree[] {
  return warm.folders.map((folder) => ({
    sourcePath: folder.sourcePath,
    path: folder.path,
    baseBranch: folder.baseBranch,
    ownsBranch: true,
  }));
}

function withFolders(
  created: CreatedResult,
  folders: readonly CreatedFolderWorktree[],
): CreatedResult {
  if (folders.length === 0) return created;
  return { ...created, additionalPaths: folderAdditionalPaths(folders) };
}

export default async function worktreePlugin(bb: BbPluginApi): Promise<void> {
  const host = bb.hosts.experimental_client({
    contract: worktreeHostContract,
    experimental_signals: worktreeHostSignals,
  });
  const reports = new Map<string, PluginEnvironmentProviderProgress>();
  const pools = await createWarmPools({ bb, host });
  bb.onDispose(() => pools.dispose());

  host.experimental_onSignal("progress", (event) => {
    const report = reports.get(event.payload.operationId);
    if (report !== undefined) reportHostProgress(report, event.payload);
  });

  async function adoptExistingWorktree(
    context: WorktreeOperation,
    path: string,
  ): Promise<PluginEnvironmentProviderCreateResult> {
    const resolved = await host.call(
      "resolveExistingWorktree",
      { sourcePath: context.projectCheckout.path, path },
      {
        hostId: context.host.id,
        signal: context.signal,
        timeoutMs: CREATE_TIMEOUT_MS,
      },
    );
    if (resolved.status === "failed") {
      return { status: "failed", message: resolved.message };
    }
    return {
      status: "created",
      path: resolved.path,
      ownsPath: false,
      resource: ADOPTED_RESOURCE,
    };
  }

  async function createManagedWorktree(
    context: WorktreeOperation,
    branch: {
      branchName: string | null;
      baseBranch: WorktreeBaseBranch;
      branchMode: "reset" | "reuse-existing";
    },
  ): Promise<PluginEnvironmentProviderCreateResult> {
    const operationId = `create#${context.pathKey}#${context.attempt}`;
    reports.set(operationId, context.report);
    try {
      const result = await host.call(
        "create",
        {
          operationId,
          sourcePath: context.projectCheckout.path,
          pathKey: context.pathKey,
          ...branch,
        },
        {
          hostId: context.host.id,
          signal: context.signal,
          timeoutMs: CREATE_TIMEOUT_MS,
        },
      );
      if (result.status === "failed") {
        return { status: "failed", message: result.message };
      }
      return {
        status: "created",
        path: result.path,
        ownsPath: true,
        ...(result.baseBranch === null
          ? {}
          : { mergeBaseBranch: result.baseBranch }),
        ...(result.ownsBranch && branch.branchName !== null
          ? {
              resource: {
                ownedBranch: {
                  name: branch.branchName,
                  repositoryPath: context.projectCheckout.path,
                  baseBranch: result.baseBranch,
                },
                folderBranches: [],
              },
            }
          : {}),
      };
    } catch (error) {
      if (context.signal.aborted) throw error;
      return { status: "failed", message: errorMessage(error) };
    } finally {
      reports.delete(operationId);
    }
  }

  async function createFolderWorktrees(
    context: WorktreeOperation,
    args: {
      path: string;
      folders: readonly string[];
      branchName: string | null;
      branchMode: "reset" | "reuse-existing";
    },
  ): Promise<
    | { status: "created"; folders: CreatedFolderWorktree[] }
    | { status: "failed"; message: string }
  > {
    if (args.folders.length === 0) return { status: "created", folders: [] };
    const operationId = `folders#${context.pathKey}#${context.attempt}`;
    reports.set(operationId, context.report);
    try {
      return await host.call(
        "createFolders",
        {
          operationId,
          sourcePath: context.projectCheckout.path,
          path: args.path,
          folders: [...args.folders],
          branchName: args.branchName,
          branchMode: args.branchMode,
        },
        {
          hostId: context.host.id,
          signal: context.signal,
          timeoutMs: CREATE_TIMEOUT_MS,
        },
      );
    } catch (error) {
      if (context.signal.aborted) throw error;
      return { status: "failed", message: errorMessage(error) };
    } finally {
      reports.delete(operationId);
    }
  }

  async function nameFolderBranches(
    context: WorktreeCreateContext,
    folders: readonly CreatedFolderWorktree[],
    branchName: string,
  ): Promise<void> {
    for (const folder of folders) {
      const operationId = `name#${context.pathKey}#${context.attempt}#${folder.path}`;
      reports.set(
        operationId,
        labelledReport(context.report, folderLabel(folder.sourcePath)),
      );
      try {
        const named = await host.call(
          "nameBranch",
          {
            operationId,
            sourcePath: folder.sourcePath,
            path: folder.path,
            branchName,
          },
          {
            hostId: context.host.id,
            signal: context.signal,
            timeoutMs: CREATE_TIMEOUT_MS,
          },
        );
        if (named.status === "failed") {
          throw new Error(
            `Could not name the branch of ${folder.path}: ${named.message}`,
          );
        }
      } finally {
        reports.delete(operationId);
      }
    }
  }

  async function nameManagedWorktree(
    context: WorktreeCreateContext,
    created: CreatedResult,
    folders: readonly CreatedFolderWorktree[],
  ): Promise<PluginEnvironmentProviderCreateResult> {
    const branchName = await context.branchName();
    const ownedBranch = {
      name: branchName,
      repositoryPath: context.projectCheckout.path,
      baseBranch: created.mergeBaseBranch ?? null,
    };
    const folderBranches = folderBranchesOf(folders, branchName);
    const operationId = `name#${context.pathKey}#${context.attempt}`;
    reports.set(operationId, context.report);
    try {
      const named = await host.call(
        "nameBranch",
        {
          operationId,
          sourcePath: context.projectCheckout.path,
          path: created.path,
          branchName,
        },
        {
          hostId: context.host.id,
          signal: context.signal,
          timeoutMs: CREATE_TIMEOUT_MS,
        },
      );
      if (named.status === "failed") {
        await removeEnvironmentWorktrees(
          context,
          created.path,
          ownedBranch,
          folderBranches,
        );
        return named;
      }
      await nameFolderBranches(context, folders, branchName);
    } catch (error) {
      await removeEnvironmentWorktrees(
        context,
        created.path,
        ownedBranch,
        folderBranches,
      );
      if (context.signal.aborted) throw error;
      return { status: "failed", message: errorMessage(error) };
    } finally {
      reports.delete(operationId);
    }
    return withFolders(
      { ...created, resource: { ownedBranch, folderBranches } },
      folders,
    );
  }

  async function removeEnvironmentWorktrees(
    context: WorktreeOperation,
    path: string,
    ownedBranch: OwnedBranch | null,
    folderBranches: OwnedBranch[],
  ): Promise<void> {
    await host
      .call(
        "remove",
        {
          operationId: `unname#${context.pathKey}#${context.attempt}`,
          pathKey: context.pathKey,
          path,
          ownedBranch,
          folderBranches,
        },
        { hostId: context.host.id, timeoutMs: REMOVE_TIMEOUT_MS },
      )
      .catch(() => undefined);
  }

  async function listProjectFolderPaths(args: {
    projectId: string;
    hostId: string;
  }): Promise<string[]> {
    const project = await bb.sdk.projects.get({ projectId: args.projectId });
    const source = project.sources.find(
      (candidate) =>
        candidate.type === "local_path" && candidate.hostId === args.hostId,
    );
    if (source === undefined) return [];
    const folders = await bb.sdk.projects.sources.experimental_folders.list({
      projectId: args.projectId,
      sourceId: source.id,
    });
    return folders.map((folder) => folder.path);
  }

  async function matchProjectFolders(context: {
    project: { id: string };
    host: { id: string };
    inputs: WorktreeInputs;
  }): Promise<{ folders: string[]; unknown: string[] }> {
    if ("kind" in context.inputs || context.inputs.folders.length === 0) {
      return { folders: [], unknown: [] };
    }
    const projectFolders = await listProjectFolderPaths({
      projectId: context.project.id,
      hostId: context.host.id,
    });
    const folders: string[] = [];
    const unknown: string[] = [];
    for (const requested of context.inputs.folders) {
      const match = projectFolders.find(
        (folderPath) =>
          trimTrailingSeparators(folderPath) ===
          trimTrailingSeparators(requested),
      );
      if (match === undefined) unknown.push(requested);
      else if (!folders.includes(match)) folders.push(match);
    }
    return { folders, unknown };
  }

  function unknownFolderMessage(
    context: { project: { id: string }; host: { name: string } },
    folder: string,
  ): string {
    return `${folder} is not one of this project's folders on ${context.host.name}, so it can't be branched. List them with \`bb project folder list ${context.project.id}\`.`;
  }

  bb.experimental_environments.register({
    apiVersion: 2,
    id: GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
    displayName: "Worktree",
    description: "Create an isolated Git worktree for your changes.",
    icon: "FolderGit",
    requires: { gitCheckout: true },
    inputs: worktreeInputsSchema,
    policy: { pathKeys: "per-attempt" },
    locate: ({ inputs }) =>
      "kind" in inputs ? { path: inputs.path, reuse: true } : null,
    async validate(context) {
      const { unknown } = await matchProjectFolders(context);
      return unknown[0] === undefined
        ? { action: "accept" }
        : {
            action: "refuse",
            message: unknownFolderMessage(context, unknown[0]),
          };
    },
    async create(context) {
      if ("kind" in context.inputs) {
        return adoptExistingWorktree(context, context.inputs.path);
      }
      const branched = await matchProjectFolders(context);
      if (branched.unknown[0] !== undefined) {
        return {
          status: "failed",
          message: unknownFolderMessage(context, branched.unknown[0]),
        };
      }
      if (context.inputs.branch.kind === "default") {
        const ownedBranch = (name: string, baseBranch: string) => ({
          name,
          repositoryPath: context.projectCheckout.path,
          baseBranch,
        });
        const warm = await pools.handOff({
          environmentId: context.environment.id,
          projectId: context.project.id,
          hostId: context.host.id,
          sourcePath: context.projectCheckout.path,
          folders: branched.folders,
          adopt: (environmentId, handed) =>
            context.adopt(environmentId, {
              ownedBranch: ownedBranch(handed.placeholder, handed.baseBranch),
              folderBranches: folderBranchesOf(
                warmFolderWorktrees(handed),
                handed.placeholder,
              ),
            }),
          signal: context.signal,
        });
        if (warm !== null) {
          const folders = warmFolderWorktrees(warm);
          const commit = warm.baseCommit.slice(0, 7);
          const hostOptions = {
            hostId: context.host.id,
            signal: context.signal,
            timeoutMs: CREATE_TIMEOUT_MS,
          };
          let branchName: string | null = null;
          try {
            const movedFolders = warm.folders.filter(
              (folder) => folder.memberCommit !== folder.baseCommit,
            );
            for (const folder of movedFolders) {
              context.report.step(
                `Moved the warm worktree of ${folder.sourcePath} from ${folder.memberCommit.slice(0, 7)} to ${folder.baseCommit.slice(0, 7)}; its setup runs again`,
              );
            }
            if (warm.memberCommit !== warm.baseCommit) {
              context.report.step(
                `Moved the warm worktree from ${warm.memberCommit.slice(0, 7)} to ${commit}; setup runs again`,
              );
            } else if (movedFolders.length > 0) {
              context.report.step(
                "Setup runs again in the warm worktree after its folders moved",
              );
            }
            if (
              warm.memberCommit !== warm.baseCommit ||
              movedFolders.length > 0
            )
              await context.setup(warm.path, {
                folders: movedFolders.map((folder) => folder.path),
              });
            context.report.step(
              warm.offline
                ? `Using a warm worktree at the last fetched ${warm.baseBranch} (${commit}); it may be out of date`
                : `Using a warm worktree at ${warm.baseBranch} (${commit})`,
            );
            branchName = await context.branchName();
            for (const path of [
              warm.path,
              ...folders.map((folder) => folder.path),
            ])
              await host.call(
                "nameHandedOffBranch",
                {
                  path,
                  fromBranch: warm.placeholder,
                  toBranch: branchName,
                },
                hostOptions,
              );
          } catch (error) {
            if (folders.length > 0) {
              await removeEnvironmentWorktrees(
                context,
                warm.path,
                ownedBranch(branchName ?? warm.placeholder, warm.baseBranch),
                [
                  ...folderBranchesOf(folders, warm.placeholder),
                  ...(branchName === null
                    ? []
                    : folderBranchesOf(folders, branchName)),
                ],
              );
            }
            throw error;
          }
          return withFolders(
            {
              status: "created",
              path: warm.path,
              ownsPath: true,
              mergeBaseBranch: warm.baseBranch,
              resource: {
                ownedBranch: ownedBranch(branchName, warm.baseBranch),
                folderBranches: folderBranchesOf(folders, branchName),
              },
            },
            folders,
          );
        }
      }
      const created = await createManagedWorktree(context, {
        branchName: null,
        baseBranch: context.inputs.branch,
        branchMode: "reset",
      });
      if (created.status === "failed") return created;
      const folders = await createFolderWorktrees(context, {
        path: created.path,
        folders: branched.folders,
        branchName: null,
        branchMode: "reset",
      });
      if (folders.status === "failed") {
        await removeEnvironmentWorktrees(context, created.path, null, []);
        return folders;
      }
      await context.setup(created.path, {
        folders: folders.folders.map((folder) => folder.path),
      });
      return nameManagedWorktree(context, created, folders.folders);
    },
    async restore(context) {
      if ("kind" in context.inputs) {
        return adoptExistingWorktree(context, context.inputs.path);
      }
      const branchName = context.previous.environment.branchName;
      if (branchName === null) {
        return {
          status: "failed",
          message:
            "The removed worktree had no branch checked out, so there is no branch to restore it on.",
        };
      }
      const created = await createManagedWorktree(context, {
        branchName,
        baseBranch: context.inputs.branch,
        branchMode: "reuse-existing",
      });
      if (created.status === "failed") return created;
      const resource = parseWorktreeResource(created.resource ?? null);
      const ownedBranch =
        resource !== null && "ownedBranch" in resource
          ? resource.ownedBranch
          : null;
      const matched = await matchProjectFolders(context);
      for (const folder of matched.unknown) {
        context.report.step(
          `Skipped ${folder}: it is no longer one of this project's folders`,
        );
      }
      const folders = await createFolderWorktrees(context, {
        path: created.path,
        folders: matched.folders,
        branchName,
        branchMode: "reuse-existing",
      });
      if (folders.status === "failed") {
        await removeEnvironmentWorktrees(
          context,
          created.path,
          ownedBranch,
          [],
        );
        return folders;
      }
      await context.setup(created.path, {
        folders: folders.folders.map((folder) => folder.path),
      });
      const folderBranches = folderBranchesOf(
        folders.folders.filter((folder) => folder.ownsBranch),
        branchName,
      );
      return {
        ...created,
        ...(ownedBranch === null && folderBranches.length === 0
          ? {}
          : { resource: { ownedBranch, folderBranches } }),
        additionalPaths: folderAdditionalPaths(folders.folders),
      };
    },
    async remove(context) {
      const resource = parseWorktreeResource(context.resource);
      if (resource !== null && "adopted" in resource) {
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
            ownedBranch: resource?.ownedBranch ?? null,
            folderBranches: resource?.folderBranches ?? [],
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
    async listBranchableFolders({ projectId, hostId }) {
      const folders = await listProjectFolderPaths({ projectId, hostId });
      if (folders.length === 0) return { folders: [] };
      const repositories = await host.call(
        "listFolderRepositories",
        { paths: folders },
        { hostId },
      );
      return { folders: repositories.paths };
    },
    async defaultBaseBranch({ projectId, hostId }) {
      const project = await bb.sdk.projects.get({ projectId });
      const sources = project.sources.filter(
        (source) => source.type === "local_path",
      );
      const source =
        hostId === null
          ? (sources.find((source) => source.isDefault) ?? sources[0])
          : sources.find((source) => source.hostId === hostId);
      if (source === undefined) return { branch: null };
      return host.call(
        "defaultBaseBranch",
        { sourcePath: source.path },
        { hostId: source.hostId },
      );
    },
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
    warmPoolStatus: () => pools.status(),
    async setWarmPoolSize({ projectId, size }) {
      await pools.setSize(projectId, size);
      return pools.status();
    },
    async setWarmPoolHostSize({ projectId, hostId, size }) {
      await pools.setHostSize(projectId, hostId, size);
      return pools.status();
    },
    async setWarmPoolFolders({ projectId, hostId, folders }) {
      await pools.setFolders(projectId, hostId, folders);
      return pools.status();
    },
  });

  async function onlyCheckoutHost(projectId: string): Promise<string> {
    const project = await bb.sdk.projects.get({ projectId });
    const hosts = project.sources
      .filter((source) => source.type === "local_path")
      .map((source) => source.hostId);
    const [hostId] = hosts;
    if (hostId === undefined)
      throw new Error(`Project ${projectId} has no checkout on any machine`);
    if (hosts.length > 1)
      throw new Error(
        `Project ${projectId} has checkouts on ${hosts.length} machines; pass --host <host-id>`,
      );
    return hostId;
  }

  bb.cli.register(
    defineCli({
      name: "worktree",
      summary: "Keep warm worktrees ready for new threads",
      description:
        "A project with warm worktrees keeps that many worktrees on each machine with a checkout, at its default base with setup finished, so a new worktree thread on the default base starts without waiting for git or the setup script. A machine can keep its own count instead of the project's.",
      commands: {
        "pool status": cliCommand({
          summary: "Show projects that keep warm worktrees",
          options: { json: JSON_OPTION },
          async run(input) {
            const status = await pools.status();
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(status)
                : formatWarmPoolStatus(status),
            };
          },
        }),
        "pool set": cliCommand({
          summary: "Set how many warm worktrees a project keeps",
          positionals: [
            {
              name: "project-id",
              description: "Project id, as `bb project list` prints it",
              required: true,
            },
            {
              name: "size",
              description: `A whole number from 0 to ${MAX_POOL_SIZE}; 0 turns warm worktrees off and removes the project's idle ones. With --host, \`project\` makes the machine follow the project's count again`,
              required: true,
            },
          ],
          options: {
            host: {
              type: "string",
              placeholder: "id",
              aliases: ["host-id"],
              description:
                "Set the count for one machine's checkout only, as `bb host list` prints its id",
            },
            json: JSON_OPTION,
          },
          async run(input) {
            const projectId = input.positionals["project-id"];
            const hostId = input.options.host;
            const raw = input.positionals.size;
            const size =
              hostId !== undefined && raw === "project" ? null : Number(raw);
            if (
              size !== null &&
              (!Number.isInteger(size) || size < 0 || size > MAX_POOL_SIZE)
            ) {
              throw new PluginCliError(
                hostId === undefined
                  ? `Size must be a whole number from 0 to ${MAX_POOL_SIZE}`
                  : `Size must be a whole number from 0 to ${MAX_POOL_SIZE}, or \`project\``,
                { code: "invalid_size" },
              );
            }
            if (hostId !== undefined)
              await pools.setHostSize(projectId, hostId, size);
            else if (size !== null) await pools.setSize(projectId, size);
            const status = await pools.status();
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(status)
                : formatWarmPoolStatus(status),
            };
          },
        }),
        "pool folders": cliCommand({
          summary:
            "Set which project folders get worktrees in a machine's warm worktrees",
          description:
            "The project's warm worktrees on a machine also get a worktree of each listed project folder on that machine, with setup finished, and are handed only to new threads that branch exactly those folders. Folders are set per machine because each machine's checkout has its own folder paths. List none to stop branching folders. Members made with other folders are replaced.",
          positionals: [
            {
              name: "project-id",
              description: "Project id, as `bb project list` prints it",
              required: true,
            },
            {
              name: "folders",
              description:
                "Absolute project folder paths on that machine, as `bb project folder list <project-id> --machine <host-id>` prints them",
              variadic: true,
            },
          ],
          options: {
            host: {
              type: "string",
              placeholder: "id",
              aliases: ["host-id"],
              description:
                "Machine whose checkout to set, as `bb host list` prints its id; optional when the project has one checkout",
            },
            json: JSON_OPTION,
          },
          async run(input) {
            const projectId = input.positionals["project-id"];
            try {
              const hostId =
                input.options.host ?? (await onlyCheckoutHost(projectId));
              await pools.setFolders(
                projectId,
                hostId,
                input.positionals.folders ?? [],
              );
            } catch (error) {
              throw new PluginCliError(errorMessage(error), {
                code: "invalid_folders",
              });
            }
            const status = await pools.status();
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(status)
                : formatWarmPoolStatus(status),
            };
          },
        }),
      },
    }),
  );
}

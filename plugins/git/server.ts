import { gitLifecycleStatusSchema } from "./read-contract.js";
import { parseLifecycleError } from "@bb/core-ui/lifecycle-errors";
import { resolveDiffFileRef } from "./file-ref.js";
import { viewedStorageKey, viewedStoragePrefix } from "./viewed-store.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliContext,
} from "@get-bb/plugin-sdk";
import { workspaceDiffTargetSchema } from "bb-git-contract";
import {
  gitRpcContract,
  gitHostContract,
  gitHostSignals,
  gitDependencies,
  gitCollapsedSectionsSchema,
  gitSectionIdSchema,
  parsePatchKey,
  filePathSchema,
} from "./contract.js";
import {
  rawDiffFileStatToEntry,
  selectInitialPatchPaths,
} from "./diff-tiering.js";
import {
  STATUS_MAX_FILES,
  STATUS_MAX_UNTRACKED_FILES,
  STATUS_MAX_UNTRACKED_BYTES,
  DIFF_MAX_FILES,
  PATCH_MAX_BYTES,
  DIFF_MAX_BYTES,
  DIFF_MAX_FILE_LIST_BYTES,
} from "./policy.js";

export default function gitPlugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({
    contract: gitHostContract,
    experimental_signals: gitHostSignals,
  });
  const watches = new Map<
    string,
    { environmentId: string; hostId: string; path: string; signal: AbortSignal }
  >();
  const watchLeases = new Map<
    string,
    {
      id: string;
      references: number;
      controller: AbortController;
      started: Promise<void>;
    }
  >();
  const pendingUnwatches = new Map<string, string>();
  const stopWatch = async (id: string, hostId: string) => {
    pendingUnwatches.set(id, hostId);
    try {
      await host.call("unwatch", { id }, { hostId });
      pendingUnwatches.delete(id);
    } catch (error) {
      bb.log.warn(String(error));
    }
  };
  const publishWorkspaceChange = (environmentId: string) => {
    for (const change of gitDependencies({ environmentId }))
      bb.rpc.experimental_publishChange(change);
  };
  host.experimental_onSignal("changed", ({ payload }) => {
    const watch = watches.get(payload.id);
    if (!watch) return;
    if (payload.paths === null)
      bb.rpc.experimental_publishChange({
        entity: "git-refs",
        id: watch.environmentId,
        changes: ["changed"],
      });
    else
      for (const path of payload.paths)
        bb.rpc.experimental_publishChange({
          entity: "git-file",
          id: `${watch.environmentId}:${path}`,
          changes: ["changed"],
        });
    publishWorkspaceChange(watch.environmentId);
  });
  const startWatch = async (id: string) => {
    const watch = watches.get(id);
    if (!watch || watch.signal.aborted) return;
    await host.call(
      "watch",
      { id, path: watch.path },
      { hostId: watch.hostId, signal: watch.signal },
    );
    publishWorkspaceChange(watch.environmentId);
    bb.rpc.experimental_publishChange({
      entity: "git-refs",
      id: watch.environmentId,
      changes: ["changed"],
    });
  };
  host.experimental_onWorkerExit(async ({ hostId }) => {
    for (const [id, pendingHost] of pendingUnwatches)
      if (pendingHost === hostId) pendingUnwatches.delete(id);
    for (const [id, watch] of watches) {
      if (watch.hostId === hostId) {
        publishWorkspaceChange(watch.environmentId);
        await startWatch(id).catch((error) => bb.log.warn(String(error)));
      }
    }
  });
  bb.background.service("workspace-watches", {
    async start(signal) {
      const stopHosts = bb.sdk.subscribe({
        event: "host:changed",
        callback(event) {
          if (event.changes.includes("host-connected")) {
            for (const [id, hostId] of pendingUnwatches)
              if (hostId === event.id) void stopWatch(id, hostId);
          }
          bb.rpc.experimental_publishChange({
            entity: "workspace",
            changes: ["changed"],
          });
          bb.rpc.experimental_publishChange({
            entity: "environment",
            changes: ["changed"],
          });
          for (const [id, watch] of watches) {
            if (
              event.id === watch.hostId &&
              event.changes.includes("host-connected")
            ) {
              publishWorkspaceChange(watch.environmentId);
              void startWatch(id).catch((error) => bb.log.warn(String(error)));
            }
          }
        },
      });
      const stopThreads = bb.sdk.subscribe({
        event: "thread:changed",
        callback(event) {
          bb.rpc.experimental_publishChange({
            entity: "thread",
            ...(event.id === undefined ? {} : { id: event.id }),
            changes: ["changed"],
          });
        },
      });
      const stopEnvironments = bb.sdk.subscribe({
        event: "environment:changed",
        callback(event) {
          if (event.id) {
            publishWorkspaceChange(event.id);
            if (
              event.changes.some(
                (change) =>
                  change !== "work-status-changed" &&
                  change !== "thread-storage-changed",
              )
            ) {
              bb.rpc.experimental_publishChange({
                entity: "environment",
                id: event.id,
                changes: ["changed"],
              });
              bb.rpc.experimental_publishChange({
                entity: "git-refs",
                id: event.id,
                changes: ["changed"],
              });
            }
          }
        },
      });
      try {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else
            signal.addEventListener("abort", () => resolve(), { once: true });
        });
      } finally {
        stopHosts();
        stopEnvironments();
        stopThreads();
      }
    },
  });
  async function environment(environmentId: string) {
    const result = await bb.sdk.environments.get({ environmentId });
    if (result.status !== "ready" || !result.path)
      throw new Error("Environment is not ready");
    return { ...result, path: result.path };
  }
  const notApplicable = {
    outcome: "not_applicable",
    reason: "non_git_environment",
    message: "Git diffs are not available for non-git environments",
  } as const;
  async function readHost<T>(read: () => Promise<T>) {
    try {
      return await read();
    } catch (error) {
      const lifecycle = parseLifecycleError(error);
      if (
        !lifecycle ||
        !(error instanceof Error) ||
        !("status" in error) ||
        typeof error.status !== "number"
      )
        throw error;
      return {
        outcome: "unavailable" as const,
        failure: {
          kind: "lifecycle" as const,
          status: gitLifecycleStatusSchema.parse(error.status),
          error: lifecycle,
          message: lifecycle.message,
        },
      };
    }
  }
  async function status(input: {
    environmentId: string;
    mergeBaseBranch: string | null;
  }) {
    const env = await environment(input.environmentId);
    if (!env.isGitRepo)
      return {
        ...notApplicable,
        message: "Workspace status is not available for non-git environments",
      };
    const workspace = await readHost(() =>
      host.call(
        "status",
        {
          path: env.path,
          mergeBaseBranch: input.mergeBaseBranch,
          maxFiles: STATUS_MAX_FILES,
          maxUntrackedLineStatFiles: STATUS_MAX_UNTRACKED_FILES,
          maxUntrackedLineStatBytes: STATUS_MAX_UNTRACKED_BYTES,
        },
        { hostId: env.hostId },
      ),
    );
    if ("outcome" in workspace) return workspace;
    return { outcome: "available", workspace } as const;
  }
  async function files(input: z.infer<typeof gitRpcContract.files.input>) {
    const parsed = gitRpcContract.files.input.parse(input);
    const env = await environment(parsed.environmentId);
    if (!env.isGitRepo) return notApplicable;
    const result = await readHost(() =>
      host.call(
        "files",
        {
          path: env.path,
          target: parsed.target,
          ignoreWhitespace: parsed.ignoreWhitespace,
          maxFiles: DIFF_MAX_FILES,
        },
        { hostId: env.hostId },
      ),
    );
    if ("outcome" in result) return result;
    const entries = result.files.map(rawDiffFileStatToEntry);
    const paths = selectInitialPatchPaths(entries);
    const initialPatches = paths.length
      ? await host
          .call(
            "patches",
            {
              path: env.path,
              target: parsed.target,
              paths,
              maxBytesPerFile: PATCH_MAX_BYTES,
              ignoreWhitespace: parsed.ignoreWhitespace,
            },
            { hostId: env.hostId },
          )
          .catch(() => [])
      : [];
    return {
      outcome: "available",
      ...result,
      files: entries,
      initialPatches,
    } as const;
  }
  async function diff(input: z.infer<typeof gitRpcContract.diff.input>) {
    const env = await environment(input.environmentId);
    if (!env.isGitRepo) return notApplicable;
    const result = await readHost(() =>
      host.call(
        "diff",
        {
          path: env.path,
          target: input.target,
          maxDiffBytes:
            input.purpose === "commit-message" ? 32_000 : DIFF_MAX_BYTES,
          maxFileListBytes:
            input.purpose === "commit-message"
              ? 4_000
              : DIFF_MAX_FILE_LIST_BYTES,
          maxUntrackedFiles: DIFF_MAX_FILES,
        },
        { hostId: env.hostId },
      ),
    );
    if ("outcome" in result) return result;
    return { outcome: "available", diff: result } as const;
  }
  const collapsedSectionsKey = "diff.collapsedSections";
  let collapseQueue = Promise.resolve();
  let initializeCollapsed:
    | Promise<z.infer<typeof gitCollapsedSectionsSchema>>
    | undefined;
  async function readCollapsedSections() {
    const stored = await bb.storage.kv.get<unknown>(collapsedSectionsKey);
    if (stored !== undefined && stored !== null)
      return gitCollapsedSectionsSchema.parse(stored);
    const legacy = (await bb.sdk.system.uiPreferences.list()).preferences[
      "infoPanel.collapsedSections"
    ].value;
    const migrated = legacy.flatMap((id) => {
      const parsed = gitSectionIdSchema.safeParse(id);
      return parsed.success ? [parsed.data] : [];
    });
    await bb.storage.kv.set(collapsedSectionsKey, migrated);
    return migrated;
  }
  async function collapsedSections() {
    initializeCollapsed ??= readCollapsedSections().catch((error) => {
      initializeCollapsed = undefined;
      throw error;
    });
    await initializeCollapsed;
    return gitCollapsedSectionsSchema.parse(
      await bb.storage.kv.get<unknown>(collapsedSectionsKey),
    );
  }
  bb.rpc.register(gitRpcContract, {
    async patches({ keys }) {
      const groups = new Map<
        string,
        {
          environmentId: string;
          target: z.infer<typeof workspaceDiffTargetSchema>;
          ignoreWhitespace: boolean;
          rows: { key: string; path: string }[];
        }
      >();
      for (const key of keys) {
        const { path, ...scope } = parsePatchKey(key);
        const id = JSON.stringify(scope);
        let group = groups.get(id);
        if (!group) {
          group = { ...scope, rows: [] };
          groups.set(id, group);
        }
        group.rows.push({ key, path });
      }
      const result: Record<
        string,
        z.infer<typeof gitHostContract.patches.output>[number]
      > = {};
      for (const group of groups.values()) {
        const env = await environment(group.environmentId);
        if (!env.isGitRepo) throw new Error(notApplicable.message);
        for (let offset = 0; offset < group.rows.length; offset += 50) {
          const rows = group.rows.slice(offset, offset + 50);
          const patches = await host.call(
            "patches",
            {
              path: env.path,
              target: group.target,
              ignoreWhitespace: group.ignoreWhitespace,
              paths: rows.map((row) => row.path),
              maxBytesPerFile: PATCH_MAX_BYTES,
            },
            { hostId: env.hostId },
          );
          const byPath = new Map(patches.map((patch) => [patch.path, patch]));
          for (const row of rows) {
            const patch = byPath.get(row.path);
            if (!patch) throw new Error(`No patch returned for ${row.path}`);
            result[row.key] = patch;
          }
        }
      }
      return result;
    },
    collapsedSections,
    setSectionCollapsed({ sectionId, collapsed }) {
      const operation = collapseQueue.then(async () => {
        const ids = (await collapsedSections()).filter(
          (id) => id !== sectionId,
        );
        const next = collapsed ? [...ids, sectionId] : ids;
        await bb.storage.kv.set(collapsedSectionsKey, next);
        return next;
      });
      collapseQueue = operation.then(
        () => {},
        () => {},
      );
      return operation;
    },
    async viewed({ environmentId, target, paths }) {
      await bb.sdk.environments.get({ environmentId });
      const selectedPaths =
        paths ??
        (
          await bb.storage.kv.list(viewedStoragePrefix(environmentId, target))
        ).map((key) => {
          const value: unknown = JSON.parse(key.slice("viewed/".length));
          return z
            .tuple([z.string(), z.string(), filePathSchema])
            .parse(value)[2];
        });
      const files = await Promise.all(
        [...new Set(selectedPaths)].sort().map(async (path) => {
          const revision = z
            .string()
            .min(1)
            .optional()
            .parse(
              await bb.storage.kv.get<unknown>(
                viewedStorageKey(environmentId, target, path),
              ),
            );
          return revision === undefined ? [] : [{ path, revision }];
        }),
      );
      return { files: files.flat() };
    },
    async clearViewed({ environmentId, target }) {
      await bb.sdk.environments.get({ environmentId });
      await Promise.all(
        (
          await bb.storage.kv.list(viewedStoragePrefix(environmentId, target))
        ).map((key) => bb.storage.kv.delete(key)),
      );
      return { ok: true as const };
    },
    async setViewed(input) {
      const { environmentId, target, path, viewed } = input;
      await bb.sdk.environments.get({ environmentId });
      const key = viewedStorageKey(environmentId, target, path);
      if (viewed) await bb.storage.kv.set(key, input.revision);
      else await bb.storage.kv.delete(key);
      return { ok: true as const };
    },
    status,
    files,
    diff,
    async branches({ environmentId, ...input }) {
      const env = await environment(environmentId);
      return host.call(
        "branches",
        { path: env.path, ...input },
        { hostId: env.hostId },
      );
    },
    async context({ threadId }) {
      const thread = await bb.sdk.threads.get({ threadId });
      return {
        environment:
          thread.environmentId === null
            ? null
            : await bb.sdk.environments.get({
                environmentId: thread.environmentId,
              }),
        archivedAt: thread.archivedAt,
      };
    },
  });
  async function acquireWatch(environmentId: string, signal: AbortSignal) {
    const env = await environment(environmentId);
    if (!env.isGitRepo || signal.aborted) return;
    const key = JSON.stringify([environmentId, env.hostId, env.path]);
    let lease = watchLeases.get(key);
    if (!lease) {
      const id = randomUUID();
      const controller = new AbortController();
      watches.set(id, {
        environmentId,
        hostId: env.hostId,
        path: env.path,
        signal: controller.signal,
      });
      lease = { id, references: 0, controller, started: startWatch(id) };
      watchLeases.set(key, lease);
    }
    const current = lease;
    current.references += 1;
    signal.addEventListener(
      "abort",
      () => {
        current.references -= 1;
        if (current.references !== 0) return;
        if (watchLeases.get(key) === current) watchLeases.delete(key);
        watches.delete(current.id);
        current.controller.abort();
        void stopWatch(current.id, env.hostId);
      },
      { once: true },
    );
    await current.started;
  }
  for (const method of [
    "status",
    "files",
    "diff",
    "branches",
    "patches",
  ] as const) {
    bb.rpc.experimental_whileWatched(method, async (read, signal) => {
      if ("key" in read)
        return acquireWatch(parsePatchKey(read.key).environmentId, signal);
      const input = gitRpcContract[method].input.parse(read.input);
      const environmentIds =
        "keys" in input
          ? [
              ...new Set(
                input.keys.map((key) => parsePatchKey(key).environmentId),
              ),
            ]
          : [input.environmentId];
      await Promise.all(environmentIds.map((id) => acquireWatch(id, signal)));
    });
  }
  const environmentOption = {
    type: "string",
    aliases: ["environment-id"],
    description: "Environment ID; defaults to this thread's workspace",
  } as const;
  const jsonOption = {
    type: "boolean",
    description: "Emit compact JSON",
  } as const;
  const mergeBaseOption = {
    type: "string",
    description: "Compare committed changes against this branch",
  } as const;
  const targetOptions = {
    environment: environmentOption,
    json: jsonOption,
    "merge-base-branch": mergeBaseOption,
    target: {
      type: "enum",
      values: ["uncommitted", "branch_committed", "all", "commit"],
      default: "uncommitted",
      description: "Changes to read",
    },
    sha: { type: "string", description: "Commit SHA for --target commit" },
  } as const;
  async function cliEnvironment(
    id: string | undefined,
    context: PluginCliContext,
  ) {
    const environmentId =
      id ??
      (context.threadId
        ? (await bb.sdk.threads.get({ threadId: context.threadId }))
            .environmentId
        : null);
    if (!environmentId)
      throw new Error("Pass --environment or run in a thread");
    return environmentId;
  }
  function cliTarget(options: {
    target: string;
    sha?: string;
    "merge-base-branch"?: string;
  }) {
    if (
      (options.target === "commit" || options.target === "uncommitted") &&
      options["merge-base-branch"] !== undefined
    )
      throw new Error(
        "--merge-base-branch requires --target all or branch_committed",
      );
    if (options.target === "commit")
      return workspaceDiffTargetSchema.parse({
        type: "commit",
        sha: options.sha,
      });
    if (options.sha !== undefined)
      throw new Error("--sha requires --target commit");
    return workspaceDiffTargetSchema.parse({
      type: options.target,
      ...(options.target === "uncommitted"
        ? {}
        : { mergeBaseBranch: options["merge-base-branch"] }),
    });
  }
  bb.cli.register(
    defineCli({
      name: "git",
      summary: "Read workspace Git status and changes",
      commands: {
        branches: cliCommand({
          summary: "List local and remote branches",
          options: {
            environment: environmentOption,
            json: jsonOption,
            query: {
              type: "string",
              default: "",
              description: "Filter branches",
            },
            selected: {
              type: "string",
              description: "Include the selected branch",
            },
            limit: {
              type: "integer",
              min: 1,
              max: 200,
              default: 100,
              description: "Maximum branches, up to 200",
            },
          },
          async run(input, context) {
            const result = await bb.sdk.plugins.callRpc({
              pluginId: "bb--git",
              method: "branches",
              input: {
                environmentId: await cliEnvironment(
                  input.options.environment,
                  context,
                ),
                query: input.options.query,
                selectedBranch: input.options.selected ?? null,
                limit: input.options.limit,
              },
              outputSchema: gitRpcContract.branches.output,
            });
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                result,
                null,
                input.options.json ? undefined : 2,
              ),
            };
          },
        }),
        patch: cliCommand({
          summary: "Read patches for selected changed files",
          experimental_readOnly: true,
          options: {
            ...targetOptions,
            path: {
              type: "string",
              repeatable: true,
              required: true,
              description: "Changed file path; repeat for more files",
            },
            "ignore-whitespace": {
              type: "boolean",
              description: "Ignore whitespace in diffs",
            },
          },
          async run(input, context) {
            const environmentId = await cliEnvironment(
              input.options.environment,
              context,
            );
            const target = cliTarget(input.options);
            const keys = input.options.path.map((path) =>
              JSON.stringify({
                environmentId,
                target,
                path,
                ignoreWhitespace: input.options["ignore-whitespace"] ?? false,
              }),
            );
            const result = await bb.sdk.plugins.callRpc({
              pluginId: "bb--git",
              method: "patches",
              input: { keys },
              outputSchema: gitRpcContract.patches.output,
            });
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(result)
                : keys.map((key) => result[key]?.patch ?? "").join("\n"),
            };
          },
        }),
        file: cliCommand({
          summary: "Read the old or new content of a changed file",
          experimental_readOnly: true,
          options: {
            ...targetOptions,
            path: {
              type: "string",
              required: true,
              description: "Workspace-relative file path",
            },
            side: {
              type: "enum",
              values: ["old", "new"],
              required: true,
              description: "Side of the diff",
            },
          },
          async run(input, context) {
            const environmentId = await cliEnvironment(
              input.options.environment,
              context,
            );
            const env = await environment(environmentId);
            const target = cliTarget(input.options);
            const path = filePathSchema.parse(input.options.path);
            let mergeBaseRef: string | null = null;
            if (
              input.options.side === "old" &&
              (target.type === "all" || target.type === "branch_committed")
            ) {
              const toc = await files({
                environmentId,
                target,
                ignoreWhitespace: false,
              });
              if (toc.outcome !== "available")
                throw new Error(
                  toc.outcome === "unavailable"
                    ? toc.failure.message
                    : toc.message,
                );
              mergeBaseRef = toc.mergeBaseRef;
            }
            const ref = resolveDiffFileRef(
              target,
              input.options.side,
              mergeBaseRef,
            );
            if (ref === null)
              throw new Error("No base revision is available for this file");
            const result = await bb.sdk.files.read({
              hostId: env.hostId,
              rootPath: env.path,
              path: `${env.path.replace(/[\\/]$/u, "")}/${path}`,
              ...(ref === undefined ? {} : { ref }),
            });
            return {
              exitCode: 0,
              stdout: input.options.json
                ? JSON.stringify(result)
                : result.content,
            };
          },
        }),
        "viewed list": cliCommand({
          summary: "List files marked Viewed",
          experimental_readOnly: true,
          options: {
            ...targetOptions,
            path: {
              type: "string",
              repeatable: true,
              description: "Limit to these changed paths",
            },
          },
          async run(input, context) {
            const result = await bb.sdk.plugins.callRpc({
              pluginId: "bb--git",
              method: "viewed",
              input: {
                environmentId: await cliEnvironment(
                  input.options.environment,
                  context,
                ),
                target: cliTarget(input.options),
                ...(input.options.path?.length
                  ? { paths: input.options.path }
                  : {}),
              },
              outputSchema: gitRpcContract.viewed.output,
            });
            return {
              exitCode: 0,
              stdout: JSON.stringify(
                result,
                null,
                input.options.json ? undefined : 2,
              ),
            };
          },
        }),
        "viewed mark": cliCommand({
          summary: "Mark a changed file Viewed at its current revision",
          options: {
            ...targetOptions,
            path: {
              type: "string",
              required: true,
              description: "Changed file path",
            },
          },
          async run(input, context) {
            const environmentId = await cliEnvironment(
              input.options.environment,
              context,
            );
            const target = cliTarget(input.options);
            const toc = await files({
              environmentId,
              target,
              ignoreWhitespace: false,
            });
            if (toc.outcome !== "available")
              throw new Error(
                toc.outcome === "unavailable"
                  ? toc.failure.message
                  : toc.message,
              );
            const file = toc.files.find(
              (file) => file.path === input.options.path,
            );
            if (!file)
              throw new Error(`No changed file: ${input.options.path}`);
            const result = await bb.sdk.plugins.callRpc({
              pluginId: "bb--git",
              method: "setViewed",
              input: {
                environmentId,
                target,
                path: file.path,
                revision: file.revision,
                viewed: true,
              },
              outputSchema: gitRpcContract.setViewed.output,
            });
            return { exitCode: 0, stdout: JSON.stringify(result) };
          },
        }),
        "viewed unmark": cliCommand({
          summary: "Remove a file's Viewed mark",
          options: {
            ...targetOptions,
            path: {
              type: "string",
              required: true,
              description: "Changed file path",
            },
          },
          async run(input, context) {
            const result = await bb.sdk.plugins.callRpc({
              pluginId: "bb--git",
              method: "setViewed",
              input: {
                environmentId: await cliEnvironment(
                  input.options.environment,
                  context,
                ),
                target: cliTarget(input.options),
                path: input.options.path,
                viewed: false,
              },
              outputSchema: gitRpcContract.setViewed.output,
            });
            return { exitCode: 0, stdout: JSON.stringify(result) };
          },
        }),
        "viewed clear": cliCommand({
          summary: "Clear Viewed marks for this diff target",
          options: targetOptions,
          async run(input, context) {
            const result = await bb.sdk.plugins.callRpc({
              pluginId: "bb--git",
              method: "clearViewed",
              input: {
                environmentId: await cliEnvironment(
                  input.options.environment,
                  context,
                ),
                target: cliTarget(input.options),
              },
              outputSchema: gitRpcContract.clearViewed.output,
            });
            return { exitCode: 0, stdout: JSON.stringify(result) };
          },
        }),
        status: cliCommand({
          experimental_readOnly: true,
          summary: "Read Git status",
          options: {
            environment: environmentOption,
            "merge-base-branch": mergeBaseOption,
            json: jsonOption,
          },
          async run(input, context) {
            const environmentId = await cliEnvironment(
              input.options.environment,
              context,
            );
            const result = await status({
              environmentId,
              mergeBaseBranch: input.options["merge-base-branch"] ?? null,
            });
            return {
              exitCode:
                result.outcome === "unavailable" && "error" in result.failure
                  ? 1
                  : 0,
              stdout: JSON.stringify(
                result,
                null,
                input.options.json ? undefined : 2,
              ),
            };
          },
        }),
        files: cliCommand({
          experimental_readOnly: true,
          summary: "List changed files and line counts",
          options: {
            ...targetOptions,
            "ignore-whitespace": {
              type: "boolean",
              description: "Ignore whitespace in diffs",
            },
          },
          async run(input, context) {
            const environmentId = await cliEnvironment(
              input.options.environment,
              context,
            );
            const result = await files({
              environmentId,
              target: cliTarget(input.options),
              ignoreWhitespace: input.options["ignore-whitespace"] ?? false,
            });
            return {
              exitCode:
                result.outcome === "unavailable" && "error" in result.failure
                  ? 1
                  : 0,
              stdout: JSON.stringify(
                result,
                null,
                input.options.json ? undefined : 2,
              ),
            };
          },
        }),
        diff: cliCommand({
          experimental_readOnly: true,
          summary: "Read a bounded unified diff",
          options: targetOptions,
          async run(input, context) {
            const environmentId = await cliEnvironment(
              input.options.environment,
              context,
            );
            const result = await diff({
              environmentId,
              target: cliTarget(input.options),
              purpose: "display",
            });
            return {
              exitCode:
                result.outcome === "unavailable" && "error" in result.failure
                  ? 1
                  : 0,
              stdout: input.options.json
                ? JSON.stringify(result)
                : result.outcome === "available"
                  ? result.diff.diff
                  : result.outcome === "unavailable"
                    ? result.failure.message
                    : result.message,
            };
          },
        }),
      },
    }),
  );
}

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  QueryObserver,
  type QueryObserverOptions,
  QueryClientProvider,
  type QueryClient,
  type QueryKey,
  type SetDataOptions,
} from "@tanstack/react-query";
import * as system from "@/hooks/queries/system-queries";
import * as environment from "@/hooks/queries/environment-queries";
import * as project from "@/hooks/queries/project-queries";
import * as storage from "@/hooks/queries/thread-panel-queries";
import { useHosts } from "@/hooks/queries/host-queries";
import { useHostPathExistence } from "@/hooks/queries/host-path-queries";
import { useSystemEnvironmentProviders } from "@/hooks/queries/environment-provider-queries";
import { usePluginContributions } from "@/hooks/queries/plugin-contribution-queries";
import { useAppUpdateStatus } from "@/hooks/queries/app-update-queries";
import { useServerMoveStatus } from "@/hooks/queries/server-move-queries";
import { useThreadTabs } from "@/hooks/queries/thread-tabs-query";
import { useThreadDefaultExecutionOptions } from "@/hooks/queries/thread-default-execution-options-query";
import { useTerminals } from "@/hooks/queries/thread-terminal-queries";
import { useQuery } from "@tanstack/react-query";

const registered = new WeakMap<QueryClient, Set<string>>();
const disabled = { enabled: false };

export function registerReadOwner(client: QueryClient, key: QueryKey): void {
  const keys = registered.get(client) ?? new Set<string>();
  registered.set(client, keys);
  const hash = JSON.stringify(key);
  if (keys.has(hash)) return;
  keys.add(hash);
  const id = typeof key[1] === "string" ? key[1] : "";
  const nullable = (index: number) =>
    typeof key[index] === "string" ? key[index] : null;
  const owners: Record<string, () => unknown> = {
    systemConfig: function useRead() {
      return useQuery(system.systemConfigQueryOptions());
    },
    systemProviders: function useRead() {
      return useQuery(system.systemProvidersQueryOptions());
    },
    systemExecutionOptions: function useRead() {
      return useQuery(
        system.liveSystemExecutionOptionsQueryOptions({
          environmentId: nullable(1) ?? undefined,
          hostId: nullable(2) ?? undefined,
          providerId: nullable(3) ?? undefined,
          projectId: nullable(4) ?? undefined,
        }),
      );
    },
    "machine-environment": function useRead() {
      return useQuery(system.machineEnvironmentQueryOptions(nullable(1)));
    },
    systemAppUpdate: function useRead() {
      return useAppUpdateStatus(disabled);
    },
    serverMoveStatus: function useRead() {
      return useServerMoveStatus(disabled);
    },
    systemEnvironmentProviders: function useRead() {
      return useSystemEnvironmentProviders();
    },
    "plugin-contributions": function useRead() {
      return usePluginContributions();
    },
    hosts: function useRead() {
      return useHosts(disabled);
    },
    hostPathExistence: function useRead() {
      return useHostPathExistence(id, ["fixture"]);
    },
    projectCommands: function useRead() {
      return useQuery(
        project.projectCommandsQueryOptions({
          projectId: id,
          providerId: nullable(2) ?? undefined,
          environmentId: nullable(3),
          hostId: nullable(4),
        }),
      );
    },
    projectPromptHistory: function useRead() {
      return project.useProjectPromptHistory(id, disabled);
    },
    projectPaths: function useRead() {
      return project.useProjectPathSuggestions({
        projectId: id,
        environmentId: nullable(2),
        hostId: nullable(3),
        query: "fixture",
        includeFiles: true,
        includeDirectories: true,
      });
    },
    projectSourceBranches: function useRead() {
      return project.useProjectSourceBranches(id, nullable(2), disabled);
    },
    environment: function useRead() {
      return environment.useEnvironment(id, disabled);
    },
    environmentWorkStatus: function useRead() {
      return environment.useEnvironmentWorkStatus(
        id,
        nullable(2) ?? undefined,
        disabled,
      );
    },
    environmentPullRequest: function useRead() {
      return environment.useEnvironmentPullRequest(id, disabled);
    },
    environmentMergeBaseBranches: function useRead() {
      return environment.useEnvironmentMergeBaseBranches(id, disabled);
    },
    environmentDiffFiles: function useRead() {
      return environment.useEnvironmentDiffFiles(id, {
        target: { type: "uncommitted" },
        ignoreWhitespace: false,
        enabled: false,
      });
    },
    threadTabs: function useRead() {
      return useThreadTabs(id, disabled);
    },
    threadDefaultExecutionOptions: function useRead() {
      return useThreadDefaultExecutionOptions(id, disabled);
    },
    threadStorageFiles: function useRead() {
      return storage.useThreadStorageFiles(
        id,
        { limit: 20, query: "" },
        disabled,
      );
    },
    threadStorageLocation: function useRead() {
      return storage.useThreadStorageLocation(id, disabled);
    },
    threadStoragePaths: function useRead() {
      return storage.useThreadStoragePaths(
        id,
        { limit: 20, query: "", includeFiles: true, includeDirectories: true },
        disabled,
      );
    },
    threadStorageFilePreview: function useRead() {
      return storage.useThreadStorageFilePreview(id, nullable(2), disabled);
    },
    terminals: function useRead() {
      const scope = key[1];
      return useTerminals(
        typeof scope === "object" &&
          scope !== null &&
          "threadId" in scope &&
          typeof scope.threadId === "string"
          ? { kind: "thread", threadId: scope.threadId }
          : { kind: "environment", environmentId: "fixture" },
        disabled,
      );
    },
  };
  const read = typeof key[0] === "string" ? owners[key[0]] : undefined;
  if (!read) return;
  function Owner() {
    read?.();
    return null;
  }
  const previous = new Map(
    client
      .getQueryCache()
      .getAll()
      .map((query) => [query, query.meta]),
  );
  renderToString(
    createElement(QueryClientProvider, { client }, createElement(Owner)),
  );
  const meta = client
    .getQueryCache()
    .getAll()
    .find(
      (query) =>
        query.queryKey[0] === key[0] &&
        query.meta &&
        query.meta !== previous.get(query),
    )?.meta;
  if (meta) client.setQueryDefaults(key, { meta });
}

export function seedRead<Data>(
  client: QueryClient,
  key: QueryKey,
  data: Data,
  options?: SetDataOptions,
) {
  registerReadOwner(client, key);
  return client.setQueryData(key, data, options);
}

export function observeRead<Data>(
  client: QueryClient,
  options: QueryObserverOptions<Data>,
) {
  registerReadOwner(client, options.queryKey);
  return new QueryObserver(client, options);
}

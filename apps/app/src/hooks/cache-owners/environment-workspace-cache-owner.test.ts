import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import {
  makeEnvironment,
  makeThreadListEntry,
} from "@bb/test-helpers/domain-fixtures";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import {
  environmentQueryKey,
  sidebarNavigationQueryKey,
  threadSearchQueryKey,
} from "../queries/query-keys";
import {
  applyEnvironmentUpdateResult,
  beginEnvironmentNameUpdateTransaction,
  completeEnvironmentNameUpdateTransaction,
  rollbackEnvironmentNameUpdateTransaction,
} from "./environment-workspace-cache-owner";

function makeQueryClient() {
  return createAppQueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
    showMutationErrorToasts: false,
  });
}

function makeTestEnvironment(name: string | null) {
  return makeEnvironment({
    baseBranch: null,
    branchName: "main",
    createdAt: 1000,
    hostId: "host_1",
    id: "env_1",
    name,
    path: "/tmp/project",
    projectId: "proj_1",
    updatedAt: 2000,
  });
}

function seedEnvironmentName(
  queryClient: ReturnType<typeof makeQueryClient>,
  name: string | null,
) {
  queryClient.setQueryData(
    environmentQueryKey("env_1"),
    makeTestEnvironment(name),
  );
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    makeSidebarBootstrapResponse({
      projects: [
        makeProjectWithThreadsResponse({
          id: "proj_1",
          name: "Project",
          threads: [
            makeThreadListEntry({
              environmentId: "env_1",
              environmentName: name,
              id: "thr_1",
              projectId: "proj_1",
            }),
          ],
        }),
      ],
    }),
  );
}

function readEnvironmentNames(queryClient: ReturnType<typeof makeQueryClient>) {
  const environment = queryClient.getQueryData<
    ReturnType<typeof makeTestEnvironment>
  >(environmentQueryKey("env_1"));
  const sidebar = queryClient.getQueryData<
    ReturnType<typeof makeSidebarBootstrapResponse>
  >(sidebarNavigationQueryKey());
  return {
    environment: environment?.name,
    sidebar: sidebar?.projects[0]?.threads[0]?.environmentName,
  };
}

describe("environment name update transaction", () => {
  it.each([
    { label: "rename", name: "Renamed environment" },
    { label: "clear", name: null },
  ])("optimistically applies and rolls back a $label", async ({ name }) => {
    const queryClient = makeQueryClient();
    seedEnvironmentName(queryClient, "Original environment");

    const transaction = await beginEnvironmentNameUpdateTransaction({
      environmentId: "env_1",
      name,
      queryClient,
    });

    expect(readEnvironmentNames(queryClient)).toEqual({
      environment: name,
      sidebar: name,
    });

    rollbackEnvironmentNameUpdateTransaction({ queryClient, transaction });

    expect(readEnvironmentNames(queryClient)).toEqual({
      environment: "Original environment",
      sidebar: "Original environment",
    });
  });

  it("does not overwrite a newer authoritative value during rollback", async () => {
    const queryClient = makeQueryClient();
    seedEnvironmentName(queryClient, "Original environment");
    const transaction = await beginEnvironmentNameUpdateTransaction({
      environmentId: "env_1",
      name: "Optimistic environment",
      queryClient,
    });
    applyEnvironmentUpdateResult({
      environment: makeTestEnvironment("Newer environment"),
      queryClient,
    });

    rollbackEnvironmentNameUpdateTransaction({ queryClient, transaction });

    expect(readEnvironmentNames(queryClient)).toEqual({
      environment: "Newer environment",
      sidebar: "Newer environment",
    });
  });

  it("does not let an older success overwrite a newer optimistic rename", async () => {
    const queryClient = makeQueryClient();
    seedEnvironmentName(queryClient, "Original environment");
    const older = await beginEnvironmentNameUpdateTransaction({
      environmentId: "env_1",
      name: "Older rename",
      queryClient,
    });
    const newer = await beginEnvironmentNameUpdateTransaction({
      environmentId: "env_1",
      name: "Newer rename",
      queryClient,
    });

    completeEnvironmentNameUpdateTransaction({
      environment: makeTestEnvironment("Older rename"),
      queryClient,
      transaction: older,
    });

    expect(readEnvironmentNames(queryClient)).toEqual({
      environment: "Newer rename",
      sidebar: "Newer rename",
    });

    completeEnvironmentNameUpdateTransaction({
      environment: makeTestEnvironment("Newer rename"),
      queryClient,
      transaction: newer,
    });
    expect(readEnvironmentNames(queryClient)).toEqual({
      environment: "Newer rename",
      sidebar: "Newer rename",
    });
  });
});

describe("applyEnvironmentUpdateResult", () => {
  it("invalidates cached thread search rows that render environment metadata", () => {
    const queryClient = makeQueryClient();
    const threadSearchKey = threadSearchQueryKey({
      limitPerGroup: 20,
      query: "renamed",
    });
    queryClient.setQueryData(threadSearchKey, {
      active: { results: [], total: 0 },
      archived: { results: [], total: 0 },
    });

    applyEnvironmentUpdateResult({
      environment: makeTestEnvironment("Renamed environment"),
      queryClient,
    });

    expect(queryClient.getQueryState(threadSearchKey)?.isInvalidated).toBe(
      true,
    );
  });
});

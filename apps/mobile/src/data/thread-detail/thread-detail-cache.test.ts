import type { Environment, Host } from "@bb/domain";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  environmentQueryKey,
  hostQueryKey,
  hostsQueryKey,
  threadQueryKey,
} from "@/lib/query/query-keys";
import { host as hostFixture, threadResponse } from "../test/fixtures";
import { ingestThreadDetailBootstrap } from "./thread-detail-cache";

describe("ingestThreadDetailBootstrap", () => {
  it("seeds the live thread, environment, and host caches without the includes leaking into the thread", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(hostsQueryKey(), [
      hostFixture({ id: "h1", name: "old laptop" }),
    ]);
    const environment: Environment = {
      id: "env1",
      name: "feature",
      projectId: "p1",
      hostId: "h1",
      path: "/repo",
      managed: true,
      isGitRepo: true,
      isWorktree: true,
      workspaceProvisionType: "managed-worktree",
      branchName: "feature/x",
      baseBranch: "main",
      defaultBranch: "main",
      mergeBaseBranch: "main",
      status: "ready",
      createdAt: 1,
      updatedAt: 1,
    };
    const thread = threadResponse({ id: "t1", environmentId: "env1" });

    ingestThreadDetailBootstrap(queryClient, {
      ...thread,
      environment,
      host: hostFixture({ id: "h1", name: "laptop" }),
    });

    expect(queryClient.getQueryData(threadQueryKey("t1"))).toEqual(thread);
    expect(queryClient.getQueryData(environmentQueryKey("env1"))).toBe(
      environment,
    );
    expect(queryClient.getQueryData(hostQueryKey("h1"))).toMatchObject({
      name: "laptop",
    });
    // The host list is upserted in place, not duplicated.
    expect(queryClient.getQueryData<Host[]>(hostsQueryKey())).toEqual([
      expect.objectContaining({ id: "h1", name: "laptop" }),
    ]);
  });
});

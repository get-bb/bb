// @vitest-environment jsdom

import { act, cleanup, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import { gitRpcContract } from "../rpc-contract.js";
import { useGitBranches } from "./queries.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  typed = "";
});

let typed = "";
const listeners = new Set<() => void>();

function type(query: string) {
  typed = query;
  for (const listener of listeners) listener();
}

function Branches() {
  const query = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => typed,
  );
  const branches = useGitBranches({
    environmentId: "env_1",
    query,
    selectedBranch: undefined,
    enabled: true,
  });
  return <output>{branches.data?.branches.join(",")}</output>;
}

it("only requests the branch search a typist settles on", async () => {
  const rpc: Partial<PluginRpcTestHandlers<typeof gitRpcContract>> = {
    branches: () => ({
      branches: ["main"],
      branchesTruncated: false,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: null,
    }),
  };
  const rendered = renderSlot(
    { component: Branches },
    {},
    {
      rpc: rpc as PluginRpcTestHandlers<typeof gitRpcContract>,
      experimental_rpcContract: gitRpcContract,
      pluginId: "bb--git",
    },
  );
  const branchCalls = () =>
    rendered.rpcCalls.filter((call) => call.method === "branches");
  await waitFor(() => expect(branchCalls()).toHaveLength(1));
  vi.useFakeTimers();
  for (const query of ["m", "ma", "mai", "main"]) {
    await act(async () => {
      type(query);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });
    expect(branchCalls()).toHaveLength(1);
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120);
  });
  expect(branchCalls()).toHaveLength(2);
  expect(branchCalls()[1]?.input).toMatchObject({ query: "main" });
});

it("keeps the last branches on screen while the next search loads", async () => {
  typed = "";
  let releaseSearch = () => {};
  const rpc: Partial<PluginRpcTestHandlers<typeof gitRpcContract>> = {
    branches: ({ query }) => {
      const result = {
        branches: query === undefined ? ["main", "release"] : ["release"],
        branchesTruncated: false,
        remoteBranches: [],
        remoteBranchesTruncated: false,
        selectedBranch: null,
      };
      if (query === undefined) return result;
      return new Promise((resolve) => {
        releaseSearch = () => resolve(result);
      });
    },
  };
  const rendered = renderSlot(
    { component: Branches },
    {},
    {
      rpc: rpc as PluginRpcTestHandlers<typeof gitRpcContract>,
      experimental_rpcContract: gitRpcContract,
      pluginId: "bb--git",
    },
  );
  await waitFor(() =>
    expect(rendered.container.textContent).toBe("main,release"),
  );
  await act(async () => {
    type("rel");
  });
  await waitFor(() =>
    expect(
      rendered.rpcCalls.filter((call) => call.method === "branches"),
    ).toHaveLength(2),
  );
  expect(rendered.container.textContent).toBe("main,release");

  await act(async () => {
    releaseSearch();
  });
  await waitFor(() => expect(rendered.container.textContent).toBe("release"));
});

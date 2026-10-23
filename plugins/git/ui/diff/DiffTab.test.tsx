// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import type {
  ExperimentalThreadEnvironmentState,
  ExperimentalThreadFixedTabProps,
} from "@get-bb/plugin-sdk/app";
import { makeWorkspaceStatus } from "../../testing.js";
import { gitRpcContract } from "../../rpc-contract.js";
import { makeDiffFileEntry } from "./diff-file-fixtures.js";
import { DiffTab, isDiffTabVisible } from "./DiffTab.js";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    range: { startIndex: 0, endIndex: count - 1 },
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 40,
      })),
    getTotalSize: () => count * 40,
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}));

afterEach(cleanup);

function loaded(
  overrides: Partial<
    Extract<ExperimentalThreadEnvironmentState, { state: "loaded" }>
  > = {},
): ExperimentalThreadEnvironmentState {
  return {
    state: "loaded",
    id: "env-1",
    status: "ready",
    hostActive: true,
    isGitRepo: true,
    managed: true,
    path: "/work/env-1",
    mergeBaseBranch: null,
    baseBranch: null,
    defaultBranch: "main",
    ...overrides,
  };
}

function props(
  overrides: Partial<ExperimentalThreadFixedTabProps> = {},
): ExperimentalThreadFixedTabProps {
  return {
    threadId: "thr-1",
    environment: { id: "env-1" },
    environmentState: loaded(),
    threadArchived: false,
    isOpen: true,
    ...overrides,
  };
}

const RPC: Partial<PluginRpcTestHandlers<typeof gitRpcContract>> = {
  status: ({ keys }) =>
    Object.fromEntries(
      keys.map((key) => [
        key,
        { outcome: "available" as const, workspace: makeWorkspaceStatus() },
      ]),
    ),
  files: () => ({
    outcome: "available",
    files: [],
    truncated: false,
    shortstat: "",
    mergeBaseRef: null,
    initialPatches: [],
  }),
  viewed: () => ({ files: [] }),
  branches: () => ({
    branches: [],
    branchesTruncated: false,
    remoteBranches: [],
    remoteBranchesTruncated: false,
    selectedBranch: null,
  }),
};

function renderTab(
  tabProps: ExperimentalThreadFixedTabProps,
  options: { canOpenFileExternally?: boolean } = {},
) {
  return renderSlot({ component: DiffTab }, tabProps, {
    rpc: RPC as PluginRpcTestHandlers<typeof gitRpcContract>,
    experimental_rpcContract: gitRpcContract,
    pluginId: "bb--git",
    ...options,
  });
}

describe("isDiffTabVisible", () => {
  it.each([
    ["a thread without an environment", null, false, false],
    ["an environment record still loading", { state: "loading", id: "env-1" }, false, true],
    ["an environment record that failed to load", { state: "failed", id: "env-1", retry: () => {} }, false, true],
    ["a git workspace", loaded(), false, true],
    ["a workspace that is not a git repository", loaded({ isGitRepo: false }), false, false],
    ["a managed workspace whose host is suspended", loaded({ hostActive: false }), false, true],
    ["an unmanaged workspace whose host is suspended", loaded({ hostActive: false, managed: false }), false, false],
    ["an archived thread in an unmanaged workspace", loaded({ managed: false }), true, false],
    ["an archived thread in a managed workspace", loaded(), true, true],
  ] as const)("is %s → %s", (_label, environmentState, threadArchived, visible) => {
    expect(
      isDiffTabVisible({
        environmentState: environmentState as ExperimentalThreadEnvironmentState | null,
        threadArchived,
      }),
    ).toBe(visible);
  });
});

describe("DiffTab", () => {
  it("offers core's Retry when the environment record failed to load", () => {
    const retry = vi.fn();
    renderTab(
      props({
        environment: null,
        environmentState: { state: "failed", id: "env-1", retry },
      }),
    );
    expect(
      screen.getByText("Could not determine whether this workspace uses Git."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("stays inert with its toolbar while the host is suspended", async () => {
    const rendered = renderTab(
      props({ environment: null, environmentState: loaded({ hostActive: false }) }),
    );
    expect(await screen.findByText("No diff to display.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Diff settings" })).toBeTruthy();
    expect(
      rendered.rpcCalls.filter((call) => call.method === "files"),
    ).toEqual([]);
  });

  it("requests files with the saved merge base before status arrives", async () => {
    const rendered = renderTab(
      props({ environmentState: loaded({ mergeBaseBranch: "release" }) }),
    );
    await waitFor(() =>
      expect(
        rendered.rpcCalls.find((call) => call.method === "files")?.input,
      ).toMatchObject({
        target: { type: "all", mergeBaseBranch: "release" },
      }),
    );
  });

  it.each([
    [true, 1],
    [false, 0],
  ])(
    "shows Open in editor only where this client can open files (%s)",
    async (canOpenFileExternally, buttons) => {
      renderSlot(
        { component: DiffTab },
        props(),
        {
          rpc: {
            ...RPC,
            files: () => ({
              outcome: "available",
              files: [makeDiffFileEntry({ path: "a.ts", revision: "rev-a" })],
              truncated: false,
              shortstat: "",
              mergeBaseRef: null,
              initialPatches: [],
            }),
            patches: ({ keys }) =>
              Object.fromEntries(
                keys.map((key) => [
                  key,
                  {
                    outcome: "available" as const,
                    patch: { path: "a.ts", patch: "", truncated: false },
                  },
                ]),
              ),
          } as PluginRpcTestHandlers<typeof gitRpcContract>,
          experimental_rpcContract: gitRpcContract,
          pluginId: "bb--git",
          canOpenFileExternally,
        },
      );
      await waitFor(() =>
        expect(
          screen.queryAllByRole("button", { name: /Copy path for/u }),
        ).not.toHaveLength(0),
      );
      expect(
        screen.queryAllByRole("button", { name: "Open a.ts in editor" }),
      ).toHaveLength(buttons);
    },
  );
});

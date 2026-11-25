// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import type {
  ExperimentalLiveFileTarget,
  ExperimentalThreadTabProps,
} from "@get-bb/plugin-sdk/app";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { makeWorkspaceStatus } from "../../testing.js";
import { gitRpcContract } from "../../rpc-contract.js";
import type { GitStatusRow } from "../../contract.js";
import { makeDiffFileEntry } from "./diff-file-fixtures.js";
import { DiffTab } from "./DiffTab.js";
import { useDiffTabVisible } from "./diff-tab-visible.js";

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

const PROPS: ExperimentalThreadTabProps = {
  threadId: "thr-1",
  environment: { id: "env-1" },
};

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
    repos: [],
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

function statusRows(row: GitStatusRow) {
  return ({ keys }: { keys: string[] }) =>
    Object.fromEntries(keys.map((key) => [key, row]));
}

const SDK = {
  environments: { get: async () => ({ path: "/work/env-1" }) },
};

function renderTab(
  rpc: Partial<PluginRpcTestHandlers<typeof gitRpcContract>> = {},
  options: {
    environmentId?: string;
    canOpenFileExternally?: (target: ExperimentalLiveFileTarget) => boolean;
    experimental_fixedTabTarget?: { tabId: string; target: JsonValue };
    tabVisible?: boolean;
  } = {},
) {
  const { environmentId = "env-1", ...slotOptions } = options;
  return renderSlot(
    { component: DiffTab },
    { ...PROPS, environment: { id: environmentId } },
    {
      rpc: { ...RPC, ...rpc } as PluginRpcTestHandlers<typeof gitRpcContract>,
      experimental_rpcContract: gitRpcContract,
      pluginId: "bb--git",
      sdk: SDK as never,
      ...slotOptions,
    },
  );
}

function VisibilityProbe(props: ExperimentalThreadTabProps) {
  return <output>{String(useDiffTabVisible(props))}</output>;
}

describe("useDiffTabVisible", () => {
  it.each([
    [
      "hidden without an environment",
      null,
      { outcome: "available" as const, workspace: makeWorkspaceStatus() },
      "false",
    ],
    [
      "shown for a git workspace",
      { id: "env-1" },
      { outcome: "available" as const, workspace: makeWorkspaceStatus() },
      "true",
    ],
    [
      "hidden for a workspace that is not a git repository",
      { id: "env-1" },
      {
        outcome: "not_applicable" as const,
        reason: "non_git_environment" as const,
        message: "Not a git repository.",
      },
      "false",
    ],
    [
      "shown while status fails, so the tab can offer Retry",
      { id: "env-1" },
      { outcome: "failed" as const, message: "Host is offline." },
      "true",
    ],
  ])("is %s", async (_label, environment, row, visible) => {
    renderSlot(
      { component: VisibilityProbe },
      { threadId: "thr-1", environment },
      {
        rpc: { ...RPC, status: statusRows(row) } as PluginRpcTestHandlers<
          typeof gitRpcContract
        >,
        experimental_rpcContract: gitRpcContract,
        pluginId: "bb--git",
      },
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(visible),
    );
  });
});

describe("DiffTab", () => {
  it("shows the status failure and retries the status read", async () => {
    const rendered = renderTab(
      {
        status: statusRows({ outcome: "failed", message: "Host is offline." }),
      },
      { environmentId: "env-initial-status-failure" },
    );
    expect(await screen.findByText("Host is offline.")).toBeTruthy();
    const reads = () =>
      rendered.rpcCalls.filter((call) => call.method === "status").length;
    const before = reads();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });

  it("reads no file list while the tab is not showing", async () => {
    const rendered = renderTab({}, { tabVisible: false });
    await waitFor(() =>
      expect(rendered.rpcCalls.some((call) => call.method === "status")).toBe(
        true,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(rendered.rpcCalls.some((call) => call.method === "files")).toBe(
      false,
    );
  });

  it("requests files with the merge base from its status read", async () => {
    const rendered = renderTab();
    await waitFor(() =>
      expect(
        rendered.rpcCalls.find((call) => call.method === "files")?.input,
      ).toMatchObject({ target: { type: "all" } }),
    );
  });

  it.each([
    [true, 1],
    [false, 0],
  ])(
    "shows Open in editor only where this client can open files (%s)",
    async (canOpenFileExternally, buttons) => {
      renderTab(
        {
          files: () => ({
            outcome: "available",
            files: [makeDiffFileEntry({ path: "a.ts", revision: "rev-a" })],
            truncated: false,
            shortstat: "",
            mergeBaseRef: null,
            initialPatches: [],
            repos: [],
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
        },
        {
          canOpenFileExternally: (target) =>
            canOpenFileExternally &&
            target.kind === "workspace" &&
            target.path.length > 0,
        },
      );
      await waitFor(() =>
        expect(
          screen.queryAllByRole("button", { name: "Open a.ts in editor" }),
        ).toHaveLength(buttons),
      );
    },
  );

  describe("opening a file from outside the panel", () => {
    const filesWithA = () => ({
      outcome: "available" as const,
      files: [makeDiffFileEntry({ path: "a.ts", revision: "rev-a" })],
      truncated: false,
      shortstat: "",
      mergeBaseRef: null,
      initialPatches: [],
      repos: [],
    });
    const previewCalls = (rendered: ReturnType<typeof renderTab>) =>
      rendered.navigateCalls.filter(
        (call) => call.method === "experimental_openFilePreview",
      );

    it("opens the file preview when the requested file has no diff", async () => {
      const rendered = renderTab(
        { files: filesWithA },
        {
          experimental_fixedTabTarget: {
            tabId: "diff",
            target: { kind: "file", path: "notes/ignored.md" },
          },
        },
      );
      await waitFor(() =>
        expect(previewCalls(rendered)).toEqual([
          {
            method: "experimental_openFilePreview",
            options: {
              target: {
                kind: "workspace",
                environmentId: "env-1",
                path: "notes/ignored.md",
              },
              location: null,
            },
          },
        ]),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(previewCalls(rendered)).toHaveLength(1);
    });

    it("stays on the diff when the requested file has changes", async () => {
      const rendered = renderTab(
        { files: filesWithA },
        {
          experimental_fixedTabTarget: {
            tabId: "diff",
            target: { kind: "file", path: "a.ts" },
          },
        },
      );
      await waitFor(() =>
        expect(rendered.rpcCalls.some((call) => call.method === "files")).toBe(
          true,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(previewCalls(rendered)).toEqual([]);
    });
  });
});

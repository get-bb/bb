// @vitest-environment jsdom

import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, expect, it } from "vitest";
import {
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import { gitRpcContract } from "../../rpc-contract.js";
import type { GitFilesResult, WorkspaceDiffTarget } from "../../contract.js";
import { useDiffFiles } from "./diff-data.js";
import { makeDiffFileEntry } from "./diff-file-fixtures.js";

afterEach(cleanup);

let target: WorkspaceDiffTarget = { type: "uncommitted" };
const listeners = new Set<() => void>();

function selectTarget(next: WorkspaceDiffTarget) {
  target = next;
  for (const listener of listeners) listener();
}

function Files() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => target,
  );
  const files = useDiffFiles({
    environmentId: "env_1",
    target: current,
    ignoreWhitespace: false,
    enabled: true,
  });
  const result = files.shown?.result;
  return (
    <output aria-label="files" data-loading={files.isLoading}>
      {files.shown?.target.type}:
      {result?.outcome === "available"
        ? result.files.map((file) => file.path).join(",")
        : ""}
    </output>
  );
}

function filesFor(path: string): GitFilesResult {
  return {
    outcome: "available",
    files: [makeDiffFileEntry({ path, revision: "r1" })],
    truncated: false,
    shortstat: "",
    mergeBaseRef: null,
    initialPatches: [],
  };
}

it("keeps the previous file list and its target while another target loads", async () => {
  const pending: ((value: GitFilesResult) => void)[] = [];
  const rpc: Partial<PluginRpcTestHandlers<typeof gitRpcContract>> = {
    files: ({ target: requested }) =>
      requested.type === "uncommitted"
        ? filesFor("uncommitted.ts")
        : new Promise<GitFilesResult>((resolve) => {
            pending.push(resolve);
          }),
  };
  renderSlot(
    { component: Files },
    {},
    {
      rpc: rpc as PluginRpcTestHandlers<typeof gitRpcContract>,
      experimental_rpcContract: gitRpcContract,
      pluginId: "bb--git",
    },
  );
  const output = () => screen.getByRole("status", { name: "files" });
  await waitFor(() =>
    expect(output().textContent).toBe("uncommitted:uncommitted.ts"),
  );

  act(() => selectTarget({ type: "all", mergeBaseBranch: "main" }));
  expect(output().textContent).toBe("uncommitted:uncommitted.ts");
  expect(output().getAttribute("data-loading")).toBe("false");

  await waitFor(() => expect(pending.length).toBeGreaterThan(0));
  act(() => {
    for (const resolve of pending) resolve(filesFor("all.ts"));
  });
  await waitFor(() => expect(output().textContent).toBe("all:all.ts"));
});

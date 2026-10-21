// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { makeWorkspaceStatus } from "@bb/test-helpers";
import type { ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk";
import { gitRpcContract, parsePatchKey } from "./contract.js";
import { useEnvironmentDiffPatches } from "./use-diff-patches.js";

const composerContract = {
  context: gitRpcContract.context,
  status: gitRpcContract.status,
};
const patchContract = { patches: gitRpcContract.patches };
const app = await loadPluginApp(() => import("./app.js"));
afterEach(cleanup);

it("renders the Git composer contribution from watched status and refreshes its tally", async () => {
  const slot = app.threadContextSegments[0];
  if (!slot) throw new Error("Missing Git composer contribution");
  const environment = makeMessageDispatchHookContext({
    environment: {
      id: "env-git",
      isGitRepo: true,
      status: "ready",
      hostLifecycle: "active",
    },
  }).environment;
  let insertions = 2;
  const view = renderSlot<
    ExperimentalThreadContextSegmentProps,
    typeof composerContract
  >(
    slot,
    {
      threadId: "thread-git",
      experimental_instanceId: "composer-one",
      part: "summary" as const,
      segmentCount: 1,
      isExpanded: false,
      onToggle() {},
    },
    {
      experimental_rpcContract: composerContract,
      rpc: {
        context: () => ({ environment, archivedAt: null }),
        status: () => ({
          outcome: "available",
          workspace: makeWorkspaceStatus({
            workingTree: {
              state: "dirty_uncommitted",
              hasUncommittedChanges: true,
              fileCount: 1,
              insertions,
              deletions: 0,
              lineStatsComplete: true,
              files: [
                { path: "file.ts", status: "M", insertions, deletions: 0 },
              ],
            },
          }),
        }),
      },
    },
  );
  await screen.findByRole("button", {
    name: "Changed files: Uncommitted, 1 file, +2 -0",
  });
  insertions = 7;
  await act(() =>
    view.behavior.experimental_publishRpcChange({
      entity: "workspace",
      id: "env-git",
      changes: ["changed"],
    }),
  );
  await screen.findByRole("button", {
    name: "Changed files: Uncommitted, 1 file, +7 -0",
  });
  expect(
    view.inspection.rpcCalls.filter((call) => call.method === "context"),
  ).toHaveLength(1);
});

it("refreshes only the affected keyed patch, retaining loaded patches after a refresh error", async () => {
  const revisions = new Map([
    ["a.ts", "first a"],
    ["b.ts", "first b"],
  ]);
  let fail = false;
  function Patches() {
    const patches = useEnvironmentDiffPatches("env-patches", {
      target: { type: "uncommitted" },
      ignoreWhitespace: false,
    });
    return (
      <div>
        {["a.ts", "b.ts"].map((path) => (
          <button key={path} onClick={() => patches.loadPath(path)}>
            {path}:{" "}
            {patches.getPatchState(path).patch ??
              patches.getPatchState(path).status}
          </button>
        ))}
      </div>
    );
  }
  const view = renderSlot<object, typeof patchContract>(
    { component: Patches },
    {},
    {
      experimental_rpcContract: patchContract,
      rpc: {
        patches({ keys }) {
          if (fail) throw new Error("Host disconnected");
          return Object.fromEntries(
            keys.map((key) => {
              const { path } = parsePatchKey(key);
              return [
                key,
                { path, patch: revisions.get(path) ?? "", truncated: false },
              ];
            }),
          );
        },
      },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "a.ts: idle" }));
  fireEvent.click(screen.getByRole("button", { name: "b.ts: idle" }));
  await screen.findByRole("button", { name: "a.ts: first a" });
  await screen.findByRole("button", { name: "b.ts: first b" });
  revisions.set("a.ts", "second a");
  await act(() =>
    view.behavior.experimental_publishRpcChange({
      entity: "git-file",
      id: "env-patches:a.ts",
      changes: ["changed"],
    }),
  );
  await screen.findByRole("button", { name: "a.ts: second a" });
  const lastRead = view.inspection.rpcCalls
    .filter((call) => call.method === "patches")
    .at(-1);
  expect(
    gitRpcContract.patches.input
      .parse(lastRead?.input)
      .keys.map((key) => parsePatchKey(key).path),
  ).toEqual(["a.ts"]);
  fail = true;
  const calls = view.inspection.rpcCalls.length;
  await act(() =>
    view.behavior.experimental_publishRpcChange({
      entity: "git-refs",
      id: "env-patches",
      changes: ["changed"],
    }),
  );
  await waitFor(() =>
    expect(view.inspection.rpcCalls.length).toBeGreaterThan(calls),
  );
  expect(screen.getByRole("button", { name: "a.ts: second a" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "b.ts: first b" })).toBeTruthy();
});

it("keeps the registered Diff loading view visible until context resolves, then hides it for a non-Git workspace", async () => {
  const slot = app.threadFixedTabs.find((slot) => slot.id === "diff");
  if (!slot) throw new Error("Missing pinned Diff registration");
  let resolveContext!: (
    value: import("zod").infer<typeof gitRpcContract.context.output>,
  ) => void;
  const pending = new Promise<
    import("zod").infer<typeof gitRpcContract.context.output>
  >((resolve) => {
    resolveContext = resolve;
  });
  function RegisteredDiff(props: { threadId: string }) {
    const visible = slot?.useVisible?.(props) ?? true;
    const Content = slot!.component;
    return visible ? <Content {...props} /> : null;
  }
  const view = renderSlot(
    { component: RegisteredDiff },
    { threadId: "thread-loading" },
    {
      experimental_rpcContract: composerContract,
      rpc: { context: () => pending },
    },
  );
  await screen.findByRole("status", { name: "Loading diff" });
  expect(view.inspection.rpcCalls.map((call) => call.method)).toEqual([
    "context",
  ]);
  const environment = makeMessageDispatchHookContext({
    environment: { id: "env-plain", isGitRepo: false },
  }).environment;
  await act(() => resolveContext({ environment, archivedAt: null }));
  await waitFor(() =>
    expect(screen.queryByRole("status", { name: "Loading diff" })).toBeNull(),
  );
  expect(
    view.inspection.rpcCalls.some(
      (call) => call.method === "files" || call.method === "status",
    ),
  ).toBe(false);
});

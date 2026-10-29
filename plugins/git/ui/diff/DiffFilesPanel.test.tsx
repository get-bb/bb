// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import {
  gitPatchKey,
  type DiffFileEntry,
  type DiffPatchEntry,
  type GitPatchResult,
  type WorkspaceDiffTarget,
} from "../../contract.js";
import { gitRpcContract } from "../../rpc-contract.js";
import {
  DEFAULT_DIFF_FILE_FILTERS,
  type DiffFileFilters,
} from "./diff-file-filters.js";
import type { DiffPatchState } from "./diff-data.js";
import { DiffFilesPanel } from "./DiffFilesPanel.js";
import { makeDiffFileEntry } from "./diff-file-fixtures.js";
import { useDiffFilesCollapseControls } from "./diffFilesStore.js";
import type { DiffViewedFile } from "@bb/server-contract";

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

vi.mock("./DiffFileCard.js", () => ({
  DiffFileCard: ({
    entry,
    isViewed,
    isViewedDisabled,
    onViewedChange,
    isCollapsed,
    onToggleCollapsed,
    patchState,
    onLoadPatch,
    onRetry,
  }: {
    entry: { path: string };
    isViewed: boolean;
    isViewedDisabled: boolean;
    onViewedChange: (viewed: boolean) => void;
    isCollapsed: boolean;
    onToggleCollapsed: () => void;
    patchState: DiffPatchState;
    onLoadPatch: () => void;
    onRetry: () => void;
  }) => (
    <div>
      <button
        aria-label={`Toggle ${entry.path}`}
        aria-expanded={!isCollapsed}
        onClick={onToggleCollapsed}
      />
      <input
        type="checkbox"
        aria-label={entry.path}
        checked={isViewed}
        disabled={isViewedDisabled}
        onChange={(event) => onViewedChange(event.target.checked)}
      />
      <output aria-label={`Patch ${entry.path}`} data-status={patchState.status}>
        {patchState.patch ?? patchState.error ?? ""}
      </output>
      <button aria-label={`Load ${entry.path}`} onClick={onLoadPatch} />
      <button aria-label={`Retry ${entry.path}`} onClick={onRetry} />
    </div>
  ),
}));

const ENVIRONMENT_ID = "env-1";
const TARGET: WorkspaceDiffTarget = { type: "uncommitted" };

type Handlers = Partial<PluginRpcTestHandlers<typeof gitRpcContract>>;

function renderPanel(
  props: {
    files: DiffFileEntry[];
    filters?: DiffFileFilters;
    initialPatches?: DiffPatchEntry[];
    isLive?: boolean;
    isPlaceholder?: boolean;
    scrollToPath?: string;
    onScrolledToPath?: () => void;
  },
  rpc: Handlers,
  extra?: React.ReactNode,
) {
  const panel = (next: typeof props) => (
    <>
      {extra}
      <DiffFilesPanel
        environmentId={ENVIRONMENT_ID}
        target={TARGET}
        diffIdentity="env-1:uncommitted"
        files={next.files}
        filters={next.filters ?? DEFAULT_DIFF_FILE_FILTERS}
        fileFilter=""
        initialPatches={next.initialPatches ?? []}
        presentation={{
          view: "unified",
          overflow: "scroll",
          showLineNumbers: true,
        }}
        ignoreWhitespace={false}
        isLive={next.isLive ?? true}
        isPlaceholder={next.isPlaceholder ?? false}
        scrollToPath={next.scrollToPath ?? null}
        onScrolledToPath={next.onScrolledToPath}
      />
    </>
  );
  const rendered = renderSlot(
    { component: () => panel(props) },
    {},
    {
      rpc: rpc as PluginRpcTestHandlers<typeof gitRpcContract>,
      experimental_rpcContract: gitRpcContract,
      pluginId: "bb--git",
    },
  );
  return {
    ...rendered,
    rerenderPanel: (next: typeof props) =>
      rendered.lifecycle.rerender(panel(next)),
  };
}

function patchKey(file: DiffFileEntry): string {
  return gitPatchKey({
    environmentId: ENVIRONMENT_ID,
    target: TARGET,
    ignoreWhitespace: false,
    path: file.path,
    revision: file.revision,
  });
}

function patchOf(path: string) {
  return screen.getByRole("status", { name: `Patch ${path}` });
}

function requestedPatchKeys(calls: { method: string; input: unknown }[]) {
  return calls
    .filter((call) => call.method === "patches")
    .map((call) => (call.input as { keys: string[] }).keys);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const COLLAPSE_FILES = [
  makeDiffFileEntry({ path: "a.ts", revision: "rev-a" }),
  makeDiffFileEntry({ path: "b.ts", revision: "rev-b-edited" }),
];

function CollapseControls() {
  const { toggleAllCollapsed } = useDiffFilesCollapseControls(
    "env-1:uncommitted",
    COLLAPSE_FILES,
    2,
  );
  return <button onClick={toggleAllCollapsed}>Toggle all</button>;
}

function availablePatches(keys: readonly string[]) {
  return Object.fromEntries(
    keys.map((key) => {
      const path = JSON.parse(key)[3] as string;
      const result: GitPatchResult = {
        outcome: "available",
        patch: { path, patch: `patch:${path}`, truncated: false },
      };
      return [key, result];
    }),
  );
}

it("shows Viewed only for files whose stored revision matches and marks the current revision", async () => {
  let viewed: DiffViewedFile[] = [
    { path: "a.ts", revision: "rev-a" },
    { path: "b.ts", revision: "rev-b-old" },
  ];
  const markViewed = vi.fn(
    (input: { path: string; revision: string }) => {
      viewed = [
        ...viewed.filter((file) => file.path !== input.path),
        { path: input.path, revision: input.revision },
      ];
      return { ok: true as const };
    },
  );
  const clearViewed = vi.fn((input: { path?: string }) => {
    viewed = viewed.filter((file) => file.path !== input.path);
    return { ok: true as const };
  });
  const files = (revision: string) => [
    makeDiffFileEntry({ path: "a.ts", revision: "rev-a" }),
    makeDiffFileEntry({ path: "b.ts", revision }),
  ];
  const { rerenderPanel } = renderPanel(
    { files: files("rev-b-new") },
    {
      viewed: () => ({ files: viewed }),
      markViewed,
      clearViewed,
      patches: ({ keys }) => availablePatches(keys),
    },
    <CollapseControls />,
  );

  const a = screen.getByRole("checkbox", { name: "a.ts" });
  const b = screen.getByRole("checkbox", { name: "b.ts" });
  await waitFor(() => expect((a as HTMLInputElement).disabled).toBe(false));
  expect((a as HTMLInputElement).checked).toBe(true);
  expect((b as HTMLInputElement).checked).toBe(false);

  const toggleA = screen.getByRole("button", { name: "Toggle a.ts" });
  await waitFor(() =>
    expect(toggleA.getAttribute("aria-expanded")).toBe("false"),
  );
  fireEvent.click(toggleA);
  expect(toggleA.getAttribute("aria-expanded")).toBe("true");
  expect((a as HTMLInputElement).checked).toBe(true);

  fireEvent.click(b);

  await waitFor(() => expect((b as HTMLInputElement).checked).toBe(true));
  expect(markViewed).toHaveBeenCalledWith({
    environmentId: ENVIRONMENT_ID,
    target: TARGET,
    path: "b.ts",
    revision: "rev-b-new",
  });
  const toggleB = screen.getByRole("button", { name: "Toggle b.ts" });
  await waitFor(() =>
    expect(toggleB.getAttribute("aria-expanded")).toBe("false"),
  );
  rerenderPanel({ files: files("rev-b-edited") });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Toggle b.ts" })
        .getAttribute("aria-expanded"),
    ).toBe("true"),
  );
  expect(
    (screen.getByRole("checkbox", { name: "b.ts" }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  rerenderPanel({
    files: files("rev-b-new"),
    filters: { ...DEFAULT_DIFF_FILE_FILTERS, showViewed: false },
  });
  await waitFor(() =>
    expect(screen.queryByRole("checkbox", { name: "b.ts" })).toBeNull(),
  );
  expect(
    screen.getByText("No changed files match the current filters."),
  ).toBeTruthy();
  rerenderPanel({
    files: files("rev-b-edited"),
    filters: { ...DEFAULT_DIFF_FILE_FILTERS, showViewed: false },
  });
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "b.ts" })).toBeTruthy(),
  );
  expect(screen.queryByRole("checkbox", { name: "a.ts" })).toBeNull();
  rerenderPanel({ files: files("rev-b-edited") });
  fireEvent.click(screen.getByRole("button", { name: "Toggle all" }));
  const collapsedA = screen.getByRole("button", { name: "Toggle a.ts" });
  expect(collapsedA.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("checkbox", { name: "a.ts" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("checkbox", { name: "a.ts" }) as HTMLInputElement)
        .checked,
    ).toBe(false),
  );
  expect(clearViewed).toHaveBeenCalledWith({
    environmentId: ENVIRONMENT_ID,
    target: TARGET,
    path: "a.ts",
  });
  expect(
    screen
      .getByRole("button", { name: "Toggle a.ts" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});

it("keeps a Viewed change in place while the write is pending and rolls it back when it fails", async () => {
  let rejectMark: (error: Error) => void = () => {};
  renderPanel(
    { files: [makeDiffFileEntry({ path: "a.ts", revision: "rev-a" })] },
    {
      viewed: () => ({ files: [] }),
      markViewed: () =>
        new Promise((_, reject) => {
          rejectMark = reject;
        }),
      patches: ({ keys }) => availablePatches(keys),
    },
  );
  const a = screen.getByRole("checkbox", { name: "a.ts" }) as HTMLInputElement;
  await waitFor(() => expect(a.disabled).toBe(false));

  fireEvent.click(a);
  await waitFor(() => expect(a.checked).toBe(true));

  rejectMark(new Error("write failed"));
  await waitFor(() => expect(a.checked).toBe(false));
});

it("loads visible patches by revision, reuses initial patches and loads on-demand files only when asked", async () => {
  const shown = makeDiffFileEntry({ path: "shown.ts", revision: "r1" });
  const seeded = makeDiffFileEntry({ path: "seeded.ts", revision: "r1" });
  const large = makeDiffFileEntry({
    path: "large.ts",
    revision: "r1",
    loadMode: "on_demand",
  });
  const { inspection, rerenderPanel } = renderPanel(
    {
      files: [shown, seeded, large],
      initialPatches: [
        { path: "seeded.ts", patch: "patch:seeded", truncated: false },
      ],
    },
    {
      viewed: () => ({ files: [] }),
      patches: ({ keys }) => availablePatches(keys),
    },
  );

  expect(patchOf("seeded.ts").textContent).toBe("patch:seeded");
  await waitFor(() =>
    expect(patchOf("shown.ts").textContent).toBe("patch:shown.ts"),
  );
  expect(patchOf("large.ts").getAttribute("data-status")).toBe("idle");
  expect(requestedPatchKeys(inspection.rpcCalls)).toEqual([[patchKey(shown)]]);

  fireEvent.click(screen.getByRole("button", { name: "Load large.ts" }));
  await waitFor(() =>
    expect(patchOf("large.ts").textContent).toBe("patch:large.ts"),
  );
  expect(requestedPatchKeys(inspection.rpcCalls).at(-1)).toEqual([
    patchKey(large),
  ]);

  const edited = { ...shown, revision: "r2" };
  rerenderPanel({
    files: [edited, seeded, large],
    initialPatches: [
      { path: "seeded.ts", patch: "patch:seeded", truncated: false },
    ],
  });
  await waitFor(() =>
    expect(requestedPatchKeys(inspection.rpcCalls).at(-1)).toEqual([
      patchKey(edited),
    ]),
  );
});

it("requests an edited file and a newly added file in one batch", async () => {
  const first = makeDiffFileEntry({ path: "a.ts", revision: "r1" });
  let files = [first];
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function LivePanel() {
    const current = useSyncExternalStore(subscribe, () => files);
    return (
      <DiffFilesPanel
        environmentId={ENVIRONMENT_ID}
        target={TARGET}
        diffIdentity="env-1:uncommitted"
        files={current}
        filters={DEFAULT_DIFF_FILE_FILTERS}
        fileFilter=""
        initialPatches={[]}
        presentation={{
          view: "unified",
          overflow: "scroll",
          showLineNumbers: true,
        }}
        ignoreWhitespace={false}
        isLive
        isPlaceholder={false}
      />
    );
  }
  const rpc: Handlers = {
    viewed: () => ({ files: [] }),
    patches: ({ keys }) => availablePatches(keys),
  };
  const { inspection } = renderSlot(
    { component: LivePanel },
    {},
    {
      rpc: rpc as PluginRpcTestHandlers<typeof gitRpcContract>,
      experimental_rpcContract: gitRpcContract,
      pluginId: "bb--git",
    },
  );
  await waitFor(() => expect(patchOf("a.ts").textContent).toBe("patch:a.ts"));
  const before = requestedPatchKeys(inspection.rpcCalls).length;

  const edited = { ...first, revision: "r2" };
  const added = makeDiffFileEntry({ path: "b.ts", revision: "r1" });
  act(() => {
    files = [edited, added];
    for (const listener of listeners) listener();
  });
  await waitFor(() => expect(patchOf("b.ts").textContent).toBe("patch:b.ts"));
  expect(requestedPatchKeys(inspection.rpcCalls).slice(before)).toEqual([
    [patchKey(edited), patchKey(added)],
  ]);
});

const OFFLINE_PATCH: GitPatchResult = {
  outcome: "unavailable",
  failure: {
    code: "path_not_found",
    workspacePath: "/work/repo",
    message: "Host is offline",
  },
};

it("shows a file's patch failure and retries it", async () => {
  const file = makeDiffFileEntry({ path: "a.ts", revision: "r1" });
  let available = false;
  renderPanel(
    { files: [file] },
    {
      viewed: () => ({ files: [] }),
      patches: ({ keys }) =>
        available
          ? availablePatches(keys)
          : Object.fromEntries(keys.map((key) => [key, OFFLINE_PATCH])),
    },
  );

  await waitFor(() =>
    expect(patchOf("a.ts").textContent).toBe("Host is offline"),
  );
  expect(patchOf("a.ts").getAttribute("data-status")).toBe("error");

  available = true;
  fireEvent.click(screen.getByRole("button", { name: "Retry a.ts" }));
  await waitFor(() =>
    expect(patchOf("a.ts").textContent).toBe("patch:a.ts"),
  );
});

it("retries only the patch that failed", async () => {
  const files = [
    makeDiffFileEntry({ path: "a.ts", revision: "rev-a" }),
    makeDiffFileEntry({ path: "b.ts", revision: "rev-b" }),
  ];
  const failing = new Set(["a.ts", "b.ts"]);
  const { rpcCalls } = renderPanel(
    { files },
    {
      viewed: () => ({ files: [] }),
      patches: ({ keys }) =>
        Object.fromEntries(
          keys.map((key) => {
            const path = JSON.parse(key)[3] as string;
            const result: GitPatchResult = failing.has(path)
              ? {
                  outcome: "unavailable",
                  failure: {
                    code: "unknown",
                    message: "git timed out",
                    workspacePath: "/work/env-1",
                  },
                }
              : {
                  outcome: "available",
                  patch: { path, patch: `patch:${path}`, truncated: false },
                };
            return [key, result];
          }),
        ),
    },
  );
  await waitFor(() =>
    expect(patchOf("b.ts").getAttribute("data-status")).toBe("error"),
  );
  expect(patchOf("a.ts").getAttribute("data-status")).toBe("error");
  const before = requestedPatchKeys(rpcCalls).length;

  failing.delete("b.ts");
  fireEvent.click(screen.getByRole("button", { name: "Retry b.ts" }));

  await waitFor(() => expect(patchOf("b.ts").textContent).toBe("patch:b.ts"));
  expect(requestedPatchKeys(rpcCalls).slice(before)).toEqual([
    [patchKey(files[1]!)],
  ]);
  expect(patchOf("a.ts").getAttribute("data-status")).toBe("error");
});

it("waits for the requested list before scrolling to an opened file", async () => {
  const files = [makeDiffFileEntry({ path: "a.ts", revision: "rev-a" })];
  const onScrolledToPath = vi.fn();
  const rpc: Handlers = {
    viewed: () => ({ files: [] }),
    patches: ({ keys }) => availablePatches(keys),
  };
  const { rerenderPanel } = renderPanel(
    { files, isPlaceholder: true, scrollToPath: "a.ts", onScrolledToPath },
    rpc,
  );
  await waitFor(() =>
    expect(patchOf("a.ts").getAttribute("data-status")).toBe("loaded"),
  );
  expect(onScrolledToPath).not.toHaveBeenCalled();

  rerenderPanel({ files, scrollToPath: "a.ts", onScrolledToPath });
  await waitFor(() => expect(onScrolledToPath).toHaveBeenCalled());
});

it("reads no patches or Viewed marks while the panel is closed", async () => {
  const file = makeDiffFileEntry({ path: "a.ts", revision: "r1" });
  const { inspection } = renderPanel(
    { files: [file], isLive: false },
    {
      viewed: () => ({ files: [] }),
      patches: ({ keys }) => availablePatches(keys),
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(inspection.rpcCalls).toEqual([]);
  expect(patchOf("a.ts").getAttribute("data-status")).toBe("loading");
});

// @vitest-environment jsdom
import { DEFAULT_DIFF_FILE_FILTERS } from "./diff-file-filters";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { WorkspaceDiffTarget } from "@bb/domain";
import { afterEach, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { makeDiffFileEntry } from "@/test/fixtures/diff-files";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { DiffFilesPanel } from "./DiffFilesPanel";
import { useDiffFilesCollapseControls } from "./diffFilesStore";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    environments: {
      experimental_diffViewed: vi.fn(),
      experimental_markDiffViewed: vi.fn(),
      experimental_clearDiffViewed: vi.fn(),
    },
  },
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useEnvironmentDetailRealtimeSubscription: () => {},
}));
vi.mock("@/hooks/queries/use-environment-diff-patches", () => ({
  useEnvironmentDiffPatches: () => ({
    requestPaths: () => {},
    getPatchState: () => ({ status: "idle" }),
    retry: () => {},
    loadPath: () => {},
    seedInitialPatches: () => {},
    prunePaths: () => {},
  }),
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    range: { startIndex: 0, endIndex: 1 },
    getVirtualItems: () =>
      [0, 1].map((index) => ({ index, start: index * 40 })),
    getTotalSize: () => 80,
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}));
vi.mock("./DiffFileCard", () => ({
  DiffFileCard: ({
    entry,
    isViewed,
    isViewedDisabled,
    onViewedChange,
    isCollapsed,
    onToggleCollapsed,
  }: {
    entry: { path: string };
    isViewed: boolean;
    isViewedDisabled: boolean;
    onViewedChange: (viewed: boolean) => void;
    isCollapsed: boolean;
    onToggleCollapsed: () => void;
  }) => (
    <>
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
    </>
  ),
}));

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

const TARGET: WorkspaceDiffTarget = { type: "uncommitted" };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows Viewed only for files whose stored revision matches and marks the current revision", async () => {
  const marked = {
    files: [
      { path: "a.ts", revision: "rev-a" },
      { path: "b.ts", revision: "rev-b-new" },
    ],
  };
  vi.mocked(sdk.environments.experimental_diffViewed)
    .mockResolvedValueOnce({
      files: [
        { path: "a.ts", revision: "rev-a" },
        { path: "b.ts", revision: "rev-b-old" },
      ],
    })
    .mockResolvedValue(marked);
  vi.mocked(sdk.environments.experimental_markDiffViewed).mockResolvedValue({
    ok: true,
  });
  const { wrapper: Wrapper } = createQueryClientTestHarness();

  const panel = (revision: string, showViewed = true) => (
    <Wrapper>
      <CollapseControls />
      <DiffFilesPanel
        environmentId="env-1"
        target={TARGET}
        diffIdentity="env-1:uncommitted"
        files={[
          makeDiffFileEntry({ path: "a.ts", revision: "rev-a" }),
          makeDiffFileEntry({ path: "b.ts", revision }),
        ]}
        filters={{ ...DEFAULT_DIFF_FILE_FILTERS, showViewed }}
        fileFilter=""
        initialPatches={[]}
        filesUpdatedAt={1}
        presentation={{
          view: "unified",
          overflow: "scroll",
          showLineNumbers: true,
        }}
        ignoreWhitespace={false}
        isPanelOpen
      />
    </Wrapper>
  );
  const { rerender } = render(panel("rev-b-new"));

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
  await waitFor(() =>
    expect(sdk.environments.experimental_markDiffViewed).toHaveBeenCalledWith({
      environmentId: "env-1",
      target: TARGET,
      path: "b.ts",
      revision: "rev-b-new",
    }),
  );
  const toggleB = screen.getByRole("button", { name: "Toggle b.ts" });
  await waitFor(() =>
    expect(toggleB.getAttribute("aria-expanded")).toBe("false"),
  );
  rerender(panel("rev-b-edited"));
  await waitFor(() =>
    expect(toggleB.getAttribute("aria-expanded")).toBe("true"),
  );
  expect((b as HTMLInputElement).checked).toBe(false);
  rerender(panel("rev-b-new", false));
  await waitFor(() =>
    expect(screen.queryByRole("checkbox", { name: "b.ts" })).toBeNull(),
  );
  expect(
    screen.getByText("No changed files match the current filters."),
  ).toBeTruthy();
  rerender(panel("rev-b-edited", false));
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "b.ts" })).toBeTruthy(),
  );
  expect(screen.queryByRole("checkbox", { name: "a.ts" })).toBeNull();
  rerender(panel("rev-b-edited"));
  fireEvent.click(screen.getByRole("button", { name: "Toggle all" }));
  const collapsedA = screen.getByRole("button", { name: "Toggle a.ts" });
  expect(collapsedA.getAttribute("aria-expanded")).toBe("false");
  const unmarked = { files: [{ path: "b.ts", revision: "rev-b-new" }] };
  vi.mocked(sdk.environments.experimental_diffViewed).mockResolvedValue(
    unmarked,
  );
  vi.mocked(sdk.environments.experimental_clearDiffViewed).mockResolvedValue({
    ok: true,
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "a.ts" }));
  await waitFor(() =>
    expect(sdk.environments.experimental_clearDiffViewed).toHaveBeenCalled(),
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("checkbox", { name: "a.ts" }) as HTMLInputElement)
        .checked,
    ).toBe(false),
  );
  expect(collapsedA.getAttribute("aria-expanded")).toBe("false");
});

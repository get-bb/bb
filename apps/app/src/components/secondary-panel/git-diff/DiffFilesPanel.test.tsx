// @vitest-environment jsdom
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
  }: {
    entry: { path: string };
    isViewed: boolean;
    isViewedDisabled: boolean;
    onViewedChange: (viewed: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label={entry.path}
      checked={isViewed}
      disabled={isViewedDisabled}
      onChange={(event) => onViewedChange(event.target.checked)}
    />
  ),
}));

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
  vi.mocked(sdk.environments.experimental_markDiffViewed).mockResolvedValue(
    marked,
  );
  const { wrapper: Wrapper } = createQueryClientTestHarness();

  render(
    <Wrapper>
      <DiffFilesPanel
        environmentId="env-1"
        target={TARGET}
        diffIdentity="env-1:uncommitted"
        files={[
          makeDiffFileEntry({ path: "a.ts", revision: "rev-a" }),
          makeDiffFileEntry({ path: "b.ts", revision: "rev-b-new" }),
        ]}
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
    </Wrapper>,
  );

  const a = screen.getByRole("checkbox", { name: "a.ts" });
  const b = screen.getByRole("checkbox", { name: "b.ts" });
  await waitFor(() => expect((a as HTMLInputElement).disabled).toBe(false));
  expect((a as HTMLInputElement).checked).toBe(true);
  expect((b as HTMLInputElement).checked).toBe(false);

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
});

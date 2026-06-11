// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiffFileEntry } from "@bb/server-contract";
import type { DiffPatchState } from "@/hooks/queries/use-environment-diff-patches";
import { DiffFileCard } from "./DiffFileCard";

interface MockFileDiffProps {
  fileDiff: { name?: string };
}

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: MockFileDiffProps) => (
    <div data-testid="diff-view" data-name={fileDiff.name ?? "missing"}>
      Rendered diff
    </div>
  ),
}));

vi.mock("usehooks-ts", () => ({
  useIntersectionObserver: () => ({
    ref: () => {},
    isIntersecting: true,
  }),
}));

const MODIFIED_PATCH = [
  "diff --git a/src/file.ts b/src/file.ts",
  "index 1111111..2222222 100644",
  "--- a/src/file.ts",
  "+++ b/src/file.ts",
  "@@ -1 +1 @@",
  "-export const value = 1;",
  "+export const value = 2;",
  "",
].join("\n");

// `FilePathLink` renders its label through `TruncateStart`, which prepends a
// U+200E (LRM) marker, so an exact-text query misses. Match the button by its
// normalized text content instead.
function getLinkByText(container: HTMLElement, text: string): HTMLElement {
  const match = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes(text),
  );
  if (!match) {
    throw new Error(`No link button containing "${text}"`);
  }
  return match;
}

function buildEntry(overrides: Partial<DiffFileEntry> = {}): DiffFileEntry {
  return {
    path: "src/file.ts",
    previousPath: null,
    changeKind: "modified",
    additions: 1,
    deletions: 1,
    binary: false,
    origin: "tracked",
    loadMode: "auto",
    ...overrides,
  };
}

interface RenderCardOptions {
  entry?: Partial<DiffFileEntry>;
  patchState?: DiffPatchState;
  onLoadPatch?: () => void;
  onRetry?: () => void;
  onOpenFilePreview?: (path: string) => void;
}

function renderCard(options: RenderCardOptions = {}) {
  return render(
    <DiffFileCard
      entry={buildEntry(options.entry)}
      diffViewOptions={{}}
      isCollapsed={false}
      onToggleCollapsed={() => {}}
      patchState={options.patchState ?? { status: "idle" }}
      onLoadPatch={options.onLoadPatch ?? (() => {})}
      onRetry={options.onRetry ?? (() => {})}
      onOpenFilePreview={options.onOpenFilePreview}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DiffFileCard", () => {
  it("renders a header from the entry without any patch", () => {
    renderCard({ entry: { loadMode: "on_demand" } });
    expect(screen.getByTitle("src/file.ts")).toBeTruthy();
    expect(screen.queryByTestId("diff-view")).toBeNull();
  });

  it("shows a Load diff CTA for on_demand files and triggers a fetch", () => {
    const onLoadPatch = vi.fn();
    renderCard({ entry: { loadMode: "on_demand" }, onLoadPatch });
    fireEvent.click(screen.getByRole("button", { name: "Load diff" }));
    expect(onLoadPatch).toHaveBeenCalledTimes(1);
  });

  it("shows a too-large notice with an open-file link", () => {
    const onOpenFilePreview = vi.fn();
    const { container } = renderCard({
      entry: { loadMode: "too_large", additions: 30000, deletions: 0 },
      onOpenFilePreview,
    });
    expect(screen.getByText(/Too large to display/)).toBeTruthy();
    fireEvent.click(getLinkByText(container, "Open file"));
    expect(onOpenFilePreview).toHaveBeenCalledWith("src/file.ts");
  });

  it("renders the parsed patch once it loads for an auto file", () => {
    renderCard({
      patchState: { status: "loaded", patch: MODIFIED_PATCH, truncated: false },
    });
    expect(screen.getByTestId("diff-view")).toBeTruthy();
  });

  it("offers a Show full diff affordance for a truncated patch", () => {
    const onOpenFilePreview = vi.fn();
    const { container } = renderCard({
      patchState: { status: "loaded", patch: MODIFIED_PATCH, truncated: true },
      onOpenFilePreview,
    });
    fireEvent.click(getLinkByText(container, "Show full diff"));
    expect(onOpenFilePreview).toHaveBeenCalledWith("src/file.ts");
  });

  it("surfaces a per-card error with Retry", () => {
    const onRetry = vi.fn();
    renderCard({
      patchState: { status: "error", error: "boom" },
      onRetry,
    });
    expect(screen.getByText("boom")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows a skeleton while an auto file's patch loads", () => {
    const { container } = renderCard({ patchState: { status: "loading" } });
    expect(screen.queryByTestId("diff-view")).toBeNull();
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });
});

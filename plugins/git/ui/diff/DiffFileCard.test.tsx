// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  DiffFileContentsResult,
  RequestDiffFileContents,
} from "@bb/shared-ui/git-diff/card-body";
import type { DiffFileEntry } from "../../contract.js";
import type { DiffPatchState } from "./diff-data.js";
import { DiffFileCard, type DiffFileCardProps } from "./DiffFileCard.js";
import { makeDiffFileEntry } from "./diff-file-fixtures.js";

vi.mock("usehooks-ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("usehooks-ts")>()),
  useIntersectionObserver: () => ({
    ref: () => {},
    isIntersecting: true,
    entry: undefined,
  }),
}));

const IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/Qo3AAAAAElFTkSuQmCC";

const TEXT_PATCH = [
  "diff --git a/src/file.ts b/src/file.ts",
  "--- a/src/file.ts",
  "+++ b/src/file.ts",
  "@@ -1,2 +1,2 @@",
  "-const b = 2;",
  "+const b = 3;",
  "",
].join("\n");

function buildEntry(overrides: Partial<DiffFileEntry> = {}): DiffFileEntry {
  return makeDiffFileEntry({
    additions: 1,
    deletions: 1,
    ...overrides,
  });
}

function renderCard({
  entry,
  onLoadPatch = vi.fn(),
  onRequestFileContents,
  patchState = { status: "idle" },
}: {
  entry: DiffFileEntry;
  onLoadPatch?: () => void;
  onRequestFileContents?: RequestDiffFileContents;
  patchState?: DiffPatchState;
}) {
  const props: DiffFileCardProps = {
    ignoreWhitespace: false,
    isViewed: false,
    isViewedDisabled: false,
    onViewedChange: () => {},
    entry,
    presentation: {
      view: "unified",
      overflow: "scroll",
      showLineNumbers: true,
    },
    isCollapsed: false,
    onToggleCollapsed: () => {},
    patchState,
    onLoadPatch,
    onRetry: () => {},
    onRequestFileContents,
  };
  return renderSlot({ component: DiffFileCard }, props);
}

afterEach(() => {
  cleanup();
});

describe("DiffFileCard", () => {
  it("previews on-demand binary images without loading the binary patch", async () => {
    const imageResult: DiffFileContentsResult = {
      kind: "image",
      dataUrl: IMAGE_DATA_URL,
      sizeBytes: 20_480,
    };
    const onLoadPatch = vi.fn();
    const onRequestFileContents = vi.fn<RequestDiffFileContents>(
      async () => imageResult,
    );

    renderCard({
      entry: buildEntry({
        path: "assets/logo.png",
        changeKind: "added",
        additions: 0,
        deletions: 0,
        binary: true,
        loadMode: "on_demand",
      }),
      onLoadPatch,
      onRequestFileContents,
    });

    const preview = await screen.findByRole("img", {
      name: "assets/logo.png",
    });

    expect(preview.getAttribute("src")).toBe(IMAGE_DATA_URL);
    expect(screen.queryByText("Load diff")).toBeNull();
    expect(onLoadPatch).not.toHaveBeenCalled();
    expect(onRequestFileContents).toHaveBeenCalledTimes(1);
    expect(onRequestFileContents).toHaveBeenCalledWith(
      "assets/logo.png",
      "new",
    );
  });

  it("keeps the load gate for non-image binary files", async () => {
    const onLoadPatch = vi.fn();
    const onRequestFileContents = vi.fn<RequestDiffFileContents>(async () => ({
      kind: "image",
      dataUrl: IMAGE_DATA_URL,
      sizeBytes: 20_480,
    }));

    renderCard({
      entry: buildEntry({
        path: "assets/archive.bin",
        additions: 0,
        deletions: 0,
        binary: true,
        loadMode: "on_demand",
      }),
      onLoadPatch,
      onRequestFileContents,
    });

    await waitFor(() => {
      expect(screen.getByText("Binary file.")).toBeTruthy();
    });
    screen.getByRole("button", { name: "Load diff" }).click();
    expect(onLoadPatch).toHaveBeenCalledOnce();
    expect(onRequestFileContents).not.toHaveBeenCalled();
  });

  it("falls back to the load gate when an image-looking path is not previewable", async () => {
    const onLoadPatch = vi.fn();
    const onRequestFileContents = vi.fn<RequestDiffFileContents>(
      async () => null,
    );

    renderCard({
      entry: buildEntry({
        path: "assets/not-actually-image.png",
        additions: 0,
        deletions: 0,
        binary: true,
        loadMode: "on_demand",
      }),
      onLoadPatch,
      onRequestFileContents,
    });

    await waitFor(() => {
      expect(screen.getByText("Binary file.")).toBeTruthy();
    });
    expect(screen.getByText("Load diff")).toBeTruthy();
    expect(onRequestFileContents).toHaveBeenCalledTimes(2);
    expect(onLoadPatch).not.toHaveBeenCalled();
  });

  it("renders a loaded patch through bb's diff viewer with the panel presentation", async () => {
    renderCard({
      entry: buildEntry(),
      patchState: { status: "loaded", patch: TEXT_PATCH },
    });

    const diff = await screen.findByTestId("bb-diff");
    expect(diff.textContent).toBe(TEXT_PATCH);
    expect(diff.getAttribute("data-path")).toBe("src/file.ts");
    expect(diff.getAttribute("data-view")).toBe("unified");
  });

  it("reports whitespace-only changes when whitespace is hidden", () => {
    const props: DiffFileCardProps = {
      ignoreWhitespace: true,
      isViewed: false,
      isViewedDisabled: false,
      onViewedChange: () => {},
      entry: buildEntry(),
      presentation: { view: "unified", overflow: "scroll", showLineNumbers: true },
      isCollapsed: false,
      onToggleCollapsed: () => {},
      patchState: { status: "loaded", patch: "" },
      onLoadPatch: () => {},
      onRetry: () => {},
    };
    renderSlot({ component: DiffFileCard }, props);

    expect(screen.getByText("Only whitespace changes.")).toBeTruthy();
  });
});

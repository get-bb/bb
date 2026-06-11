// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitDiffCard,
  type DiffFileContentsResult,
  type RequestDiffFileContents,
} from "./GitDiffCard";
import { parseGitDiffFiles } from "./git-diff-parsing";

interface MockFileDiffProps {
  fileDiff: MockFileDiff;
}

interface MockFileDiff {
  oldLines?: string[];
  newLines?: string[];
}

interface RequestedDiffFileContent {
  path: string;
  side: "old" | "new";
}

interface DeferredDiffFileContentRequest extends RequestedDiffFileContent {
  resolve: (result: DiffFileContentsResult | null) => void;
}

function textContents(path: string, contents: string): DiffFileContentsResult {
  return { kind: "text", file: { name: path, contents } };
}

type ClipboardWriteText = (text: string) => Promise<void>;

function installClipboardWriteTextMock() {
  const writeText = vi.fn<ClipboardWriteText>();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: MockFileDiffProps) => (
    <div
      data-testid="diff-view"
      data-old-lines={fileDiff.oldLines?.length ?? "missing"}
      data-new-lines={fileDiff.newLines?.length ?? "missing"}
    >
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

const NEW_FILE_DIFF = [
  "diff --git a/src/new-file.ts b/src/new-file.ts",
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  "+++ b/src/new-file.ts",
  "@@ -0,0 +1 @@",
  "+export const value = 1;",
  "",
].join("\n");

const DELETED_FILE_DIFF = [
  "diff --git a/src/deleted-file.ts b/src/deleted-file.ts",
  "deleted file mode 100644",
  "index 1111111..0000000",
  "--- a/src/deleted-file.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-export const value = 1;",
  "",
].join("\n");

const MODIFIED_FILE_DIFF = [
  "diff --git a/src/modified-file.ts b/src/modified-file.ts",
  "index 1111111..2222222 100644",
  "--- a/src/modified-file.ts",
  "+++ b/src/modified-file.ts",
  "@@ -1 +1 @@",
  "-export const value = 1;",
  "+export const value = 2;",
  "",
].join("\n");

const MODIFIED_FILE_DIFF_WITH_EXTRA_LINE = [
  "diff --git a/src/modified-file.ts b/src/modified-file.ts",
  "index 1111111..3333333 100644",
  "--- a/src/modified-file.ts",
  "+++ b/src/modified-file.ts",
  "@@ -1 +1,2 @@",
  "-export const value = 1;",
  "+export const value = 2;",
  "+export const extra = true;",
  "",
].join("\n");

const ADDED_IMAGE_DIFF = [
  "diff --git a/assets/logo.png b/assets/logo.png",
  "new file mode 100644",
  "index 0000000..1111111",
  "GIT binary patch",
  "literal 95",
  "zcmeAS@N?(olHy`uVBq!ia0vp^0wB!61|;P_|4#",
  "",
].join("\n");

const MODIFIED_IMAGE_DIFF = [
  "diff --git a/assets/logo.png b/assets/logo.png",
  "index 1111111..2222222 100644",
  "GIT binary patch",
  "delta 64",
  "zcmV-G0Kfm_0q_7",
  "delta 64",
  "zcmV-G0Kfl_0q_8",
  "",
].join("\n");

const DELETED_IMAGE_DIFF = [
  "diff --git a/assets/logo.png b/assets/logo.png",
  "deleted file mode 100644",
  "index 1111111..0000000",
  "GIT binary patch",
  "literal 0",
  "HcmV?d00001",
  "",
].join("\n");

const OLD_IMAGE_DATA_URL = "data:image/png;base64,b2xk";
const NEW_IMAGE_DATA_URL = "data:image/png;base64,bmV3";
const OLD_IMAGE_SIZE_BYTES = 12_288; // 12 KB
const NEW_IMAGE_SIZE_BYTES = 20_480; // 20 KB

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GitDiffCard", () => {
  it("copies an absolute file path when a workspace root is provided", async () => {
    const modifiedFile = parseGitDiffFiles(MODIFIED_FILE_DIFF)[0];
    expect(modifiedFile).toBeDefined();
    if (!modifiedFile) return;
    const writeText = installClipboardWriteTextMock();

    render(
      <GitDiffCard
        fileDiff={modifiedFile}
        diffViewOptions={{}}
        filePathRoot="/Users/me/project"
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy path for src/modified-file.ts",
      }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "/Users/me/project/src/modified-file.ts",
      );
    });
  });

  it("keeps rendering an already-visible diff when its hunk identity changes", () => {
    const modifiedFile = parseGitDiffFiles(MODIFIED_FILE_DIFF)[0];
    const updatedModifiedFile = parseGitDiffFiles(
      MODIFIED_FILE_DIFF_WITH_EXTRA_LINE,
    )[0];
    expect(modifiedFile).toBeDefined();
    expect(updatedModifiedFile).toBeDefined();
    if (!modifiedFile || !updatedModifiedFile) return;

    const { rerender } = render(
      <GitDiffCard
        fileDiff={modifiedFile}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
      />,
    );

    expect(screen.getByTestId("diff-view")).toBeTruthy();

    rerender(
      <GitDiffCard
        fileDiff={updatedModifiedFile}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
      />,
    );

    expect(screen.getByTestId("diff-view")).toBeTruthy();
  });

  it("gates deleted file rendering and content loading behind an explicit load action", async () => {
    const deletedFile = parseGitDiffFiles(DELETED_FILE_DIFF)[0];
    expect(deletedFile).toBeDefined();
    if (!deletedFile) return;
    const requests: RequestedDiffFileContent[] = [];
    const requestFileContents: RequestDiffFileContents = async (path, side) => {
      requests.push({ path, side });
      return textContents(path, "export const value = 1;\n");
    };

    render(
      <GitDiffCard
        fileDiff={deletedFile}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    expect(screen.queryByText("Deleted")).toBeNull();
    expect(screen.getByText("This file was deleted.")).toBeTruthy();
    expect(screen.queryByTestId("diff-view")).toBeNull();
    expect(requests).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Load diff" }));

    expect(screen.getByTestId("diff-view")).toBeTruthy();
    await waitFor(() => {
      expect(requests).toEqual([{ path: "src/deleted-file.ts", side: "old" }]);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("diff-view").getAttribute("data-old-lines"),
      ).toBe("1");
    });
    expect(screen.getByTestId("diff-view").getAttribute("data-new-lines")).toBe(
      "0",
    );
  });

  it("does not fetch the missing side for added files", async () => {
    const addedFile = parseGitDiffFiles(NEW_FILE_DIFF)[0];
    expect(addedFile).toBeDefined();
    if (!addedFile) return;
    const requests: RequestedDiffFileContent[] = [];
    const requestFileContents: RequestDiffFileContents = async (path, side) => {
      requests.push({ path, side });
      return textContents(path, "export const value = 1;\n");
    };

    render(
      <GitDiffCard
        fileDiff={addedFile}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    await waitFor(() => {
      expect(requests).toEqual([{ path: "src/new-file.ts", side: "new" }]);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("diff-view").getAttribute("data-old-lines"),
      ).toBe("0");
    });
    expect(screen.getByTestId("diff-view").getAttribute("data-new-lines")).toBe(
      "1",
    );
  });

  it("marks null content as unavailable without retrying until the file changes", async () => {
    const modifiedFile = parseGitDiffFiles(MODIFIED_FILE_DIFF)[0];
    expect(modifiedFile).toBeDefined();
    if (!modifiedFile) return;
    const requests: RequestedDiffFileContent[] = [];
    const requestFileContents: RequestDiffFileContents = async (path, side) => {
      requests.push({ path, side });
      return null;
    };

    const { rerender } = render(
      <GitDiffCard
        fileDiff={modifiedFile}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    await waitFor(() => {
      expect(requests).toEqual([
        { path: "src/modified-file.ts", side: "old" },
        { path: "src/modified-file.ts", side: "new" },
      ]);
    });

    rerender(
      <GitDiffCard
        fileDiff={modifiedFile}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    expect(requests).toHaveLength(2);
  });

  it("handles rejected content requests without retrying until the file changes", async () => {
    const modifiedFile = parseGitDiffFiles(MODIFIED_FILE_DIFF)[0];
    expect(modifiedFile).toBeDefined();
    if (!modifiedFile) return;
    const requests: RequestedDiffFileContent[] = [];
    const requestFileContents: RequestDiffFileContents = (path, side) => {
      requests.push({ path, side });
      return Promise.reject(new Error("Cannot read file"));
    };

    const { rerender } = render(
      <GitDiffCard
        fileDiff={modifiedFile}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    await waitFor(() => {
      expect(requests).toEqual([
        { path: "src/modified-file.ts", side: "old" },
        { path: "src/modified-file.ts", side: "new" },
      ]);
    });

    rerender(
      <GitDiffCard
        fileDiff={modifiedFile}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    expect(requests).toHaveLength(2);
  });

  it("retries cancelled in-flight content loading when the card becomes renderable again", async () => {
    const modifiedFile = parseGitDiffFiles(MODIFIED_FILE_DIFF)[0];
    expect(modifiedFile).toBeDefined();
    if (!modifiedFile) return;
    const requests: DeferredDiffFileContentRequest[] = [];
    const requestFileContents: RequestDiffFileContents = (path, side) =>
      new Promise<DiffFileContentsResult | null>((resolve) => {
        requests.push({ path, side, resolve });
      });

    const { rerender } = render(
      <GitDiffCard
        fileDiff={modifiedFile}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });

    rerender(
      <GitDiffCard
        fileDiff={modifiedFile}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering
        onRequestFileContents={requestFileContents}
      />,
    );
    rerender(
      <GitDiffCard
        fileDiff={modifiedFile}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    await waitFor(() => {
      expect(requests).toHaveLength(4);
    });
    expect(requests.map(({ path, side }) => ({ path, side }))).toEqual([
      { path: "src/modified-file.ts", side: "old" },
      { path: "src/modified-file.ts", side: "new" },
      { path: "src/modified-file.ts", side: "old" },
      { path: "src/modified-file.ts", side: "new" },
    ]);

    await act(async () => {
      requests[2]?.resolve(
        textContents("src/modified-file.ts", "export const value = 1;\n"),
      );
      requests[3]?.resolve(
        textContents("src/modified-file.ts", "export const value = 2;\n"),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("diff-view").getAttribute("data-old-lines"),
      ).toBe("1");
    });
    expect(screen.getByTestId("diff-view").getAttribute("data-new-lines")).toBe(
      "1",
    );
  });

  it("renders an added image as a single preview without fetching the old side", async () => {
    const addedImage = parseGitDiffFiles(ADDED_IMAGE_DIFF)[0];
    expect(addedImage).toBeDefined();
    if (!addedImage) return;
    const requests: RequestedDiffFileContent[] = [];
    const requestFileContents: RequestDiffFileContents = async (path, side) => {
      requests.push({ path, side });
      return {
        kind: "image",
        dataUrl: NEW_IMAGE_DATA_URL,
        sizeBytes: NEW_IMAGE_SIZE_BYTES,
      };
    };

    render(
      <GitDiffCard
        fileDiff={addedImage}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    await waitFor(() => {
      expect(requests).toEqual([{ path: "assets/logo.png", side: "new" }]);
    });
    const image = await screen.findByRole("img", {
      name: "assets/logo.png",
    });
    expect(image.getAttribute("src")).toBe(NEW_IMAGE_DATA_URL);
    // Added size shows in the header; no body caption for a single image.
    expect(screen.getByText("+20 KB")).toBeTruthy();
    expect(screen.queryByText("Added")).toBeNull();
    expect(screen.queryByTestId("diff-view")).toBeNull();
  });

  it("shows a deleted image preview and size without a Load diff step", async () => {
    const deletedImage = parseGitDiffFiles(DELETED_IMAGE_DIFF)[0];
    expect(deletedImage).toBeDefined();
    if (!deletedImage) return;
    const requests: RequestedDiffFileContent[] = [];
    const requestFileContents: RequestDiffFileContents = async (path, side) => {
      requests.push({ path, side });
      return {
        kind: "image",
        dataUrl: OLD_IMAGE_DATA_URL,
        sizeBytes: OLD_IMAGE_SIZE_BYTES,
      };
    };

    render(
      <GitDiffCard
        fileDiff={deletedImage}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    // Unlike deleted text files, the image preview is not gated behind a
    // "Load diff" action — the header size and preview load on viewport entry.
    expect(screen.queryByText("This file was deleted.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load diff" })).toBeNull();
    const image = await screen.findByRole("img", {
      name: "assets/logo.png",
    });
    expect(image.getAttribute("src")).toBe(OLD_IMAGE_DATA_URL);
    expect(screen.getByText("-12 KB")).toBeTruthy();
    expect(requests).toEqual([{ path: "assets/logo.png", side: "old" }]);
  });

  it("renders old and new previews with the +/- size pair for a modified image", async () => {
    const modifiedImage = parseGitDiffFiles(MODIFIED_IMAGE_DIFF)[0];
    expect(modifiedImage).toBeDefined();
    if (!modifiedImage) return;
    const requestFileContents: RequestDiffFileContents = async (
      _path,
      side,
    ) => ({
      kind: "image",
      dataUrl: side === "old" ? OLD_IMAGE_DATA_URL : NEW_IMAGE_DATA_URL,
      sizeBytes: side === "old" ? OLD_IMAGE_SIZE_BYTES : NEW_IMAGE_SIZE_BYTES,
    });

    render(
      <GitDiffCard
        fileDiff={modifiedImage}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    const oldImage = await screen.findByRole("img", {
      name: "assets/logo.png (old)",
    });
    expect(oldImage.getAttribute("src")).toBe(OLD_IMAGE_DATA_URL);
    const newImage = screen.getByRole("img", {
      name: "assets/logo.png (new)",
    });
    expect(newImage.getAttribute("src")).toBe(NEW_IMAGE_DATA_URL);
    expect(screen.getByText("Old")).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
    // The header shows the new and old sizes as a +/- pair, not a net delta.
    expect(screen.getByText("+20 KB")).toBeTruthy();
    expect(screen.getByText("-12 KB")).toBeTruthy();
  });

  it("opens the clicked image preview in a lightbox", async () => {
    const modifiedImage = parseGitDiffFiles(MODIFIED_IMAGE_DIFF)[0];
    expect(modifiedImage).toBeDefined();
    if (!modifiedImage) return;
    const requestFileContents: RequestDiffFileContents = async (
      _path,
      side,
    ) => ({
      kind: "image",
      dataUrl: side === "old" ? OLD_IMAGE_DATA_URL : NEW_IMAGE_DATA_URL,
      sizeBytes: side === "old" ? OLD_IMAGE_SIZE_BYTES : NEW_IMAGE_SIZE_BYTES,
    });

    render(
      <GitDiffCard
        fileDiff={modifiedImage}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    const oldImage = await screen.findByRole("img", {
      name: "assets/logo.png (old)",
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(oldImage);

    const dialog = await screen.findByRole("dialog");
    const lightboxImages = within(dialog).getAllByRole("img", {
      name: "assets/logo.png (old)",
    });
    expect(lightboxImages.map((image) => image.getAttribute("src"))).toEqual([
      OLD_IMAGE_DATA_URL,
    ]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Next image" }));
    expect(
      within(dialog)
        .getByRole("img", { name: "assets/logo.png (new)" })
        .getAttribute("src"),
    ).toBe(NEW_IMAGE_DATA_URL);

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close image preview" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("shows an unavailable message when image content cannot be loaded", async () => {
    const modifiedImage = parseGitDiffFiles(MODIFIED_IMAGE_DIFF)[0];
    expect(modifiedImage).toBeDefined();
    if (!modifiedImage) return;
    const requestFileContents: RequestDiffFileContents = async () => null;

    render(
      <GitDiffCard
        fileDiff={modifiedImage}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
        onRequestFileContents={requestFileContents}
      />,
    );

    expect(
      await screen.findByText("No preview available for this image."),
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("keeps zero-hunk image cards body-less without a content fetcher", () => {
    const modifiedImage = parseGitDiffFiles(MODIFIED_IMAGE_DIFF)[0];
    expect(modifiedImage).toBeDefined();
    if (!modifiedImage) return;

    render(
      <GitDiffCard
        fileDiff={modifiedImage}
        diffViewOptions={{}}
        isCollapsed={false}
        onToggleCollapsed={() => {}}
        isRendering={false}
      />,
    );

    expect(screen.queryByTestId("diff-view")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "assets/logo.png has no changes to expand",
      }),
    ).toBeTruthy();
  });
});

// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import type {
  DiffFileContentsResult,
  RequestDiffFileContents,
} from "@bb/shared-ui/git-diff/card-body";
import type { DiffFileEntry } from "../../contract.js";
import { DiffFileCard, type DiffFileCardProps } from "./DiffFileCard.js";
import { makeDiffFileEntry } from "./diff-file-fixtures.js";

function findDiffView() {
  return screen.findByTestId("bb-diff");
}

function hasFullFileContents(): boolean {
  return (
    screen.getByTestId("bb-diff").getAttribute("data-has-full-file-contents") ===
    "true"
  );
}

const MODIFIED_PATCH = [
  "diff --git a/src/file.ts b/src/file.ts",
  "index 1111111..2222222 100644",
  "--- a/src/file.ts",
  "+++ b/src/file.ts",
  "@@ -2,3 +2,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " const c = 4;",
  "",
].join("\n");

const OLD_FILE_CONTENTS = [
  "// header",
  "const a = 1;",
  "const b = 2;",
  "const c = 4;",
  "// footer",
  "",
].join("\n");
const NEW_FILE_CONTENTS = OLD_FILE_CONTENTS.replace(
  "const b = 2;",
  "const b = 3;",
);

const ADDED_PATCH = [
  "diff --git a/src/new.ts b/src/new.ts",
  "new file mode 100644",
  "index 0000000..2222222",
  "--- /dev/null",
  "+++ b/src/new.ts",
  "@@ -0,0 +1,2 @@",
  "+const a = 1;",
  "+const b = 2;",
  "",
].join("\n");

function buildEntry(overrides: Partial<DiffFileEntry> = {}): DiffFileEntry {
  return makeDiffFileEntry({
    additions: 1,
    deletions: 1,
    ...overrides,
  });
}

function textResult(contents: string, name: string): DiffFileContentsResult {
  return { kind: "text", file: { name, contents } };
}

function stubPointer(kind: "coarse" | "fine") {
  vi.stubGlobal("matchMedia", (query: string): MediaQueryList => ({
    matches: kind === "coarse" && query === POINTER_COARSE_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function cardProps(
  entry: DiffFileEntry,
  patch: string,
  onRequestFileContents: RequestDiffFileContents,
): DiffFileCardProps {
  return {
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
    patchState: { status: "loaded", patch, truncated: false },
    onLoadPatch: () => {},
    onRetry: () => {},
    onRequestFileContents,
  };
}

function renderModifiedCard(onRequestFileContents: RequestDiffFileContents) {
  renderSlot(
    { component: DiffFileCard },
    cardProps(buildEntry(), MODIFIED_PATCH, onRequestFileContents),
  );
}

describe("DiffFileCard context expansion", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class IntersectionObserverMock {
        readonly thresholds = [0];
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders a modified text diff from the patch alone on coarse pointers and fetches contents only on demand", async () => {
    stubPointer("coarse");
    const onRequestFileContents = vi.fn<RequestDiffFileContents>(
      async (path, side) =>
        textResult(
          side === "old" ? OLD_FILE_CONTENTS : NEW_FILE_CONTENTS,
          path,
        ),
    );

    renderModifiedCard(onRequestFileContents);

    await findDiffView();
    const expandButton = await screen.findByRole("button", {
      name: "Expand context",
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(onRequestFileContents).not.toHaveBeenCalled();
    expect(hasFullFileContents()).toBe(false);

    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(onRequestFileContents).toHaveBeenCalledTimes(2);
    });
    expect(onRequestFileContents).toHaveBeenCalledWith("src/file.ts", "old");
    expect(onRequestFileContents).toHaveBeenCalledWith("src/file.ts", "new");
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Expand context" }),
      ).toBeNull();
    });
    expect(hasFullFileContents()).toBe(true);
  });

  it("requests the contents during idle time on fine pointers without an explicit action", async () => {
    stubPointer("fine");
    const onRequestFileContents = vi.fn<RequestDiffFileContents>(
      async (path, side) =>
        textResult(
          side === "old" ? OLD_FILE_CONTENTS : NEW_FILE_CONTENTS,
          path,
        ),
    );

    renderModifiedCard(onRequestFileContents);

    await waitFor(() => {
      expect(onRequestFileContents).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByRole("button", { name: "Expand context" })).toBeNull();
  });

  it("offers a retry when the context fetch fails", async () => {
    stubPointer("coarse");
    let shouldFail = true;
    const onRequestFileContents = vi.fn<RequestDiffFileContents>(
      async (path, side) => {
        if (shouldFail) {
          throw new Error("offline");
        }
        return textResult(
          side === "old" ? OLD_FILE_CONTENTS : NEW_FILE_CONTENTS,
          path,
        );
      },
    );

    renderModifiedCard(onRequestFileContents);

    fireEvent.click(
      await screen.findByRole("button", { name: "Expand context" }),
    );
    const retryButton = await screen.findByRole("button", { name: "Retry" });
    expect(onRequestFileContents).toHaveBeenCalledTimes(2);

    shouldFail = false;
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(onRequestFileContents).toHaveBeenCalledTimes(4);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });
  });

  it("never fetches contents for an added file, whose patch already carries every line", async () => {
    stubPointer("fine");
    const onRequestFileContents = vi.fn<RequestDiffFileContents>(async (path) =>
      textResult("const a = 1;\nconst b = 2;\n", path),
    );

    renderSlot(
      { component: DiffFileCard },
      cardProps(
        buildEntry({
          path: "src/new.ts",
          changeKind: "added",
          additions: 2,
          deletions: 0,
        }),
        ADDED_PATCH,
        onRequestFileContents,
      ),
    );

    await findDiffView();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onRequestFileContents).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Expand context" })).toBeNull();
  });
});

// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "./FilePreview";

interface MockCodeViewFileItem {
  file: MockPierreFileFile;
  id: string;
  type: "file";
}

interface MockCodeViewHandle {
  scrollTo(): void;
}

interface MockCodeViewLineSelection {
  id: string;
  range: MockSelectedLines;
}

interface MockCodeViewProps {
  items: MockCodeViewFileItem[];
  selectedLines?: MockCodeViewLineSelection | null;
}

interface MockSelectedLines {
  end: number;
  start: number;
}

interface MockPierreFileFile {
  contents: string;
  name: string;
}

vi.mock("@pierre/diffs/react", async () => {
  const React = await import("react");

  const CodeView = React.forwardRef<MockCodeViewHandle, MockCodeViewProps>(
    function CodeView({ items, selectedLines = null }, ref) {
      React.useImperativeHandle(
        ref,
        () => ({
          scrollTo: vi.fn(),
        }),
        [],
      );

      return React.createElement(
        "div",
        { "data-testid": "mock-code-view" },
        items.map((item) =>
          React.createElement(
            "div",
            { key: item.id },
            item.file.contents.split("\n").map((line, index) => {
              const lineNumber = index + 1;
              const selected =
                selectedLines !== null &&
                selectedLines.id === item.id &&
                lineNumber >= selectedLines.range.start &&
                lineNumber <= selectedLines.range.end;

              return React.createElement(
                "div",
                {
                  "data-line": lineNumber,
                  "data-line-index": String(index),
                  "data-selected-line": selected ? "single" : undefined,
                  key: lineNumber,
                },
                line,
              );
            }),
          ),
        ),
      );
    },
  );

  // FilePreview's code view now renders `<File file={...} selectedLines={...} />`
  // (single file; `selectedLines` is a `{ start, end }` range, not CodeView's
  // `{ id, range }`). Mirror CodeView's line markup so line-scroll/selection
  // assertions still hold.
  const PierreFileMock = function File({
    file,
    selectedLines = null,
  }: {
    file: { name: string; contents: string };
    selectedLines?: { start: number; end: number } | null;
  }) {
    return React.createElement(
      "div",
      { "data-testid": "mock-pierre-file" },
      file.contents.split("\n").map((line, index) => {
        const lineNumber = index + 1;
        const selected =
          selectedLines !== null &&
          lineNumber >= selectedLines.start &&
          lineNumber <= selectedLines.end;

        return React.createElement(
          "div",
          {
            "data-line": lineNumber,
            "data-line-index": String(index),
            "data-selected-line": selected ? "single" : undefined,
            key: lineNumber,
          },
          line,
        );
      }),
    );
  };

  return { CodeView, File: PierreFileMock };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("FilePreview", () => {
  it("delays the iframe loading indicator so fast app switches do not flash it", () => {
    vi.useFakeTimers();
    const { container } = render(
      <FilePreview
        path="Status"
        headerMode="none"
        state={{
          kind: "iframe",
          sandbox: null,
          title: "Review Board",
          url: "/api/v1/apps/review-board/?targetThreadId=thr_1",
        }}
      />,
    );

    expect(container.querySelector("[aria-busy]")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(159);
    });
    expect(container.querySelector("[aria-busy]")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector("[aria-busy]")).not.toBeNull();
  });

  it("cancels the iframe loading indicator when the iframe loads before the delay", () => {
    vi.useFakeTimers();
    const { container } = render(
      <FilePreview
        path="Status"
        headerMode="none"
        state={{
          kind: "iframe",
          sandbox: null,
          title: "Review Board",
          url: "/api/v1/apps/review-board/?targetThreadId=thr_1",
        }}
      />,
    );

    fireEvent.load(screen.getByTitle("Review Board"));
    act(() => {
      vi.advanceTimersByTime(160);
    });

    expect(container.querySelector("[aria-busy]")).toBeNull();
  });

  it("uses the quieter horizontal seam token for the file preview header divider", () => {
    const { container } = render(
      <FilePreview
        path="src/example.ts"
        state={{
          kind: "ready",
          lineRange: null,
          showMarkdownModeToggle: false,
          file: { name: "example.ts", contents: "const a = 1;\n" },
        }}
      />,
    );

    // The header is the panel chrome strip — its only `border-b` divider must
    // use the quieter horizontal seam, matching the browser nav bar, not the
    // generic `border-border`.
    const header = container.querySelector(".border-b");
    expect(header?.className).toContain("border-b border-border-seam");
  });

  it("renders sanitized HTML in markdown file previews", () => {
    const { container } = render(
      <FilePreview
        path="README.md"
        state={{
          kind: "ready",
          lineRange: null,
          showMarkdownModeToggle: true,
          file: {
            name: "README.md",
            contents: [
              "# Readme",
              "",
              "<kbd>Cmd</kbd>",
              '<div onmouseover="alert(1)">Body</div>',
              "<script>alert(1)</script>",
            ].join("\n"),
          },
        }}
      />,
    );

    expect(screen.getByText("Cmd")).toBeTruthy();
    expect(screen.getByText("Body").getAttribute("onmouseover")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByText("alert(1)")).toBeNull();
  });

  it("opens markdown files in source mode when they have a target line", () => {
    const { container } = render(
      <FilePreview
        path="README.md"
        state={{
          kind: "ready",
          lineRange: { startLineNumber: 2, endLineNumber: 3 },
          showMarkdownModeToggle: true,
          file: {
            name: "README.md",
            contents: ["# Readme", "Line target", "Range target"].join("\n"),
          },
        }}
      />,
    );

    expect(
      screen.getByTitle("Markdown source").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      container
        .querySelector('[data-line="2"]')
        ?.getAttribute("data-selected-line"),
    ).toBe("single");
    expect(
      container
        .querySelector('[data-line="3"]')
        ?.getAttribute("data-selected-line"),
    ).toBe("single");
  });
});

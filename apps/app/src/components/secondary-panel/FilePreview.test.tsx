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
          url: "/api/v1/apps/app_review_board/?targetThreadId=thr_1",
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
          url: "/api/v1/apps/app_review_board/?targetThreadId=thr_1",
        }}
      />,
    );

    fireEvent.load(screen.getByTitle("Review Board"));
    act(() => {
      vi.advanceTimersByTime(160);
    });

    expect(container.querySelector("[aria-busy]")).toBeNull();
  });

  it("renders sanitized HTML in markdown file previews", () => {
    const { container } = render(
      <FilePreview
        path="README.md"
        state={{
          kind: "ready",
          lineNumber: null,
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
});

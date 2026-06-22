// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "./FilePreview";

interface MockPierreFileProps {
  file: {
    contents: string;
    name: string;
  };
}

class ResizeObserverMock implements ResizeObserver {
  static instances: ResizeObserverMock[] = [];

  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }

  observe() {}
  unobserve() {}
  disconnect() {}

  trigger() {
    this.callback([], this);
  }
}

vi.mock("@pierre/diffs/react", async () => {
  const React = await import("react");

  return {
    File: ({ file }: MockPierreFileProps) =>
      React.createElement("pre", { "data-testid": "pierre-file" }, [
        file.name,
        "\n",
        file.contents,
      ]),
  };
});

function getLatestResizeObserver(): ResizeObserverMock {
  const instance = ResizeObserverMock.instances.at(-1);
  if (!instance) {
    throw new Error("Expected a ResizeObserver instance.");
  }
  return instance;
}

describe("FilePreview", () => {
  let getBoundingClientRectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ResizeObserverMock.instances = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 0, 0));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("mounts the code renderer after a hidden panel receives layout", async () => {
    render(
      <FilePreview
        headerMode="none"
        path="apps/app/src/lib/thread-read-state.ts"
        state={{
          kind: "ready",
          file: {
            name: "thread-read-state.ts",
            contents: "export const marker = true;",
          },
          lineRange: null,
          showMarkdownModeToggle: false,
        }}
      />,
    );

    expect(screen.queryByTestId("pierre-file")).toBeNull();

    getBoundingClientRectSpy.mockReturnValue(new DOMRect(0, 0, 640, 480));
    getLatestResizeObserver().trigger();

    const codeView = await screen.findByTestId("pierre-file");
    expect(codeView.textContent).toContain("thread-read-state.ts");
    expect(codeView.textContent).toContain("export const marker = true;");
  });
});

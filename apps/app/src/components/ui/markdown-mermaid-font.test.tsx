// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({
    bindFunctions: undefined,
    svg: "<svg></svg>",
  })),
}));
const fontState = vi.hoisted(() => ({ value: '"IBM Plex Sans", sans-serif' }));

vi.mock("./markdown-mermaid-loader.js", () => ({
  loadMermaid: vi.fn(async () => mermaidMock),
}));
vi.mock("@/lib/font-preference", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/font-preference")>()),
  useUiFontFamily: () => fontState.value,
}));

import { MarkdownMermaidDiagram } from "./markdown-mermaid-diagram";

afterEach(() => {
  cleanup();
  mermaidMock.initialize.mockClear();
  mermaidMock.render.mockClear();
  fontState.value = '"IBM Plex Sans", sans-serif';
});

describe("MarkdownMermaidDiagram font", () => {
  it("re-renders baked SVG output when the UI font changes", async () => {
    const { rerender } = render(
      <MarkdownMermaidDiagram
        preferredTheme="light"
        source="graph TD; A-->B"
      />,
    );

    await waitFor(() => {
      expect(mermaidMock.initialize).toHaveBeenLastCalledWith(
        expect.objectContaining({
          fontFamily: '"IBM Plex Sans", sans-serif',
        }),
      );
    });

    fontState.value = "system-ui, sans-serif";
    rerender(
      <MarkdownMermaidDiagram
        preferredTheme="light"
        source="graph TD; A-->B"
      />,
    );

    await waitFor(() => {
      expect(mermaidMock.initialize).toHaveBeenLastCalledWith(
        expect.objectContaining({ fontFamily: "system-ui, sans-serif" }),
      );
      expect(mermaidMock.initialize).toHaveBeenCalledTimes(2);
    });
  });
});

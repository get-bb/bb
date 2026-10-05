// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./markdown-preview";

const katexChunkLoads = vi.hoisted(() => ({ count: 0 }));

vi.mock("./markdown-katex.js", async (importOriginal) => {
  katexChunkLoads.count += 1;
  return importOriginal();
});

afterEach(() => {
  cleanup();
});

describe("MarkdownPreview lazy KaTeX", () => {
  it("loads KaTeX only for math and shares it across mounted previews", async () => {
    const plain = render(
      <MarkdownPreview
        content={"Plain prose with $5 and $x$ and \\$10 escaped."}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(katexChunkLoads.count).toBe(0);
    expect(plain.container.textContent).toContain("$5");
    plain.unmount();

    const first = render(<MarkdownPreview content={"One: $$a^2$$"} />);
    const second = render(<MarkdownPreview content={"Two: $$b^2$$"} />);
    const mathPieces =
      "Intro.\n\n$$\n\\frac{1}{2}\n$$\n\nMiddle paragraph.\n\n";
    const incremental = render(
      <MarkdownPreview content={"Intro.\n\n"} incrementalBlocks />,
    );
    incremental.rerender(
      <MarkdownPreview content={mathPieces} incrementalBlocks />,
    );
    expect(incremental.container.querySelector(".katex-display")).toBeNull();

    await waitFor(() => {
      expect(first.container.querySelector(".katex")).not.toBeNull();
      expect(second.container.querySelector(".katex")).not.toBeNull();
      expect(
        incremental.container.querySelector(".katex-display"),
      ).not.toBeNull();
    });
    expect(katexChunkLoads.count).toBe(1);
    expect(incremental.container.innerHTML).toBe(
      render(<MarkdownPreview content={mathPieces} />).container.innerHTML,
    );

    const third = render(<MarkdownPreview content={"Three: $$c^2$$"} />);
    expect(third.container.querySelector(".katex")).not.toBeNull();
    expect(katexChunkLoads.count).toBe(1);
  });
});

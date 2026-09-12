// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownPreview } from "./markdown-preview";

afterEach(cleanup);

describe("MarkdownPreview incremental blocks and KaTeX loading", () => {
  it("re-renders settled math pieces when KaTeX loads after they were parsed", async () => {
    const intro = "Intro.\n\n";
    const content = `${intro}$$\n\\frac{1}{2}\n$$\n\nMiddle paragraph.\n\n`;
    const incremental = render(
      <MarkdownPreview content={intro} incrementalBlocks />,
    );
    incremental.rerender(
      <MarkdownPreview content={content} incrementalBlocks />,
    );
    expect(incremental.container.querySelector(".katex-display")).toBeNull();

    await waitFor(() =>
      expect(
        incremental.container.querySelector(".katex-display"),
      ).not.toBeNull(),
    );
    const legacy = render(<MarkdownPreview content={content} />);
    expect(incremental.container.innerHTML).toBe(legacy.container.innerHTML);
  });
});

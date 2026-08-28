// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownPreview } from "./markdown-preview";

afterEach(() => {
  cleanup();
});

describe("MarkdownPreview lazy KaTeX", () => {
  it("does not load the KaTeX chunk for content without $$ math", async () => {
    const { container } = render(
      <MarkdownPreview
        content={"Plain prose with $5 and $x$ and \\$10 escaped."}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("$5");
  });

  it("loads the chunk once and re-renders every mounted preview with KaTeX", async () => {
    const first = render(<MarkdownPreview content={"One: $$a^2$$"} />);
    const second = render(<MarkdownPreview content={"Two: $$b^2$$"} />);

    await waitFor(() => {
      expect(first.container.querySelector(".katex")).not.toBeNull();
      expect(second.container.querySelector(".katex")).not.toBeNull();
    });
    const third = render(<MarkdownPreview content={"Three: $$c^2$$"} />);
    expect(third.container.querySelector(".katex")).not.toBeNull();
  });
});

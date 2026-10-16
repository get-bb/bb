// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { SecondaryPanelSelectionActions } from "./SecondaryPanelSelectionActions";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

const content = "Energy $$E = mc^2$$ is **big**.\n\n$$\n\\alpha_1 < \\beta\n$$";

function textIn(element: Element): Text {
  return document
    .createTreeWalker(element, NodeFilter.SHOW_TEXT)
    .nextNode() as Text;
}

it.each([
  [
    "whole document",
    (root: Element) => {
      const range = document.createRange();
      range.selectNodeContents(root);
      return range;
    },
    content,
  ],
  [
    "part of an inline formula",
    (root: Element) => {
      const text = textIn(root.querySelector(".katex-html")!);
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 1);
      return range;
    },
    "$$E = mc^2$$",
  ],
  [
    "prose into a display formula",
    (root: Element) => {
      const range = document.createRange();
      range.setStart(textIn(root.querySelector("strong")!), 0);
      range.setEnd(
        textIn(root.querySelector(".katex-display .katex-html")!),
        1,
      );
      return range;
    },
    "**big**.\n\n$$\n\\alpha_1 < \\beta\n$$",
  ],
])(
  "adds a selection of %s to chat with raw TeX",
  async (_name, select, expected) => {
    const onSelectionAddToChat = vi.fn();
    const { container } = render(
      <SecondaryPanelSelectionActions
        markdown
        onSelectionAddToChat={onSelectionAddToChat}
      >
        <MarkdownPreview content={content} />
      </SecondaryPanelSelectionActions>,
    );
    await waitFor(() => {
      expect(container.querySelector(".katex-display")).not.toBeNull();
    });
    const range = select(container);
    const rect = new DOMRect(10, 30, 100, 20);
    Object.defineProperties(range, {
      getBoundingClientRect: { value: () => rect },
      getClientRects: { value: () => ({ length: 1, item: () => rect }) },
    });
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event("selectionchange"));
    fireEvent.click(await screen.findByRole("button", { name: "Add to chat" }));
    expect(onSelectionAddToChat).toHaveBeenCalledWith(expected);
  },
);

it("copies a Markdown preview selection as Markdown with raw TeX", async () => {
  const { container } = render(
    <SecondaryPanelSelectionActions markdown>
      <MarkdownPreview content={content} />
    </SecondaryPanelSelectionActions>,
  );
  await waitFor(() => {
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });
  const range = document.createRange();
  range.selectNodeContents(container.firstElementChild!);
  window.getSelection()!.addRange(range);
  const data = new Map<string, string>();
  fireEvent.copy(document, {
    clipboardData: {
      setData: (type: string, value: string) => data.set(type, value),
    },
  });
  expect(data.get("text/plain")).toBe(content);
  expect(data.get("text/html")).toContain("<math");
});

// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { LazyMarkdownHtml } from "./lazy-markdown-html";
import { MarkdownPreview } from "./markdown-preview";

beforeAll(() => LazyMarkdownHtml.preload());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([
  [
    "Markdown",
    '| Name | Value |\n| --- | --- |\n| [Link](https://example.com) | a,b |\n| **Bold** | say "hi" |\n| a\\|b | `code` |\n| Lines | one<br>two |',
  ],
  [
    "CSV",
    'Name,Value\r\nLink,"a,b"\r\nBold,"say ""hi"""\r\na|b,code\r\nLines,"one\ntwo"',
  ],
])(
  "copies a rendered table as %s with formatting and delimiter escaping",
  async (format, expected) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
      <MarkdownPreview
        allowHtml
        content={
          '| Name | Value |\n| --- | --- |\n| [Link](https://example.com) | a,b |\n| **Bold** | say "hi" |\n| a\\|b | `code` |\n| Lines | one<br>two |'
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: `Copy as ${format}` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
  },
);

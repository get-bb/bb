import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChangelogInline } from "./changelog-inline";

function render(text: string): string {
  return renderToStaticMarkup(createElement(ChangelogInline, { text }));
}

describe("ChangelogInline", () => {
  it("renders bold Markdown and inline code", () => {
    expect(
      render(
        "**Node.js 22.19 is now the minimum.** Use `max`; keep `**literal**` as code.",
      ),
    ).toBe(
      "<strong>Node.js 22.19 is now the minimum.</strong> Use <code>max</code>; keep <code>**literal**</code> as code.",
    );
  });

  it("renders inline code inside bold text", () => {
    expect(render("**Run `bb plugin install` now.**")).toBe(
      "<strong>Run <code>bb plugin install</code> now.</strong>",
    );
  });

  it("preserves unmatched Markdown delimiters as text", () => {
    expect(render("Keep **this and `that readable")).toBe(
      "Keep **this and `that readable",
    );
  });
});

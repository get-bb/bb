// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LazyMarkdownHtml } from "./lazy-markdown-html";
import { MarkdownPreview } from "./markdown-preview";

await LazyMarkdownHtml.preload();

afterEach(cleanup);

const dateToken = "<!date^1700000000^{date_short}|November checkpoint>";

describe("Slack date fallbacks", () => {
  it.each([false, true])("preserves dates with allowHtml=%s", (allowHtml) => {
    const { container } = render(
      <MarkdownPreview
        allowHtml={allowHtml}
        content={`Checkpoint: ${dateToken}; next: ${dateToken}.`}
      />,
    );

    expect(container.textContent).toBe(
      "Checkpoint: November checkpoint; next: November checkpoint.",
    );
  });

  it("preserves dates alongside sanitized HTML", () => {
    const { container } = render(
      <MarkdownPreview
        allowHtml
        content={`Checkpoint: ${dateToken}, <b>ready</b>.`}
      />,
    );

    expect(container.textContent).toBe(
      "Checkpoint: November checkpoint, ready.",
    );
    expect(container.querySelector("b")?.textContent).toBe("ready");
  });

  it("leaves tokens inside inline and fenced code unchanged", () => {
    const { container } = render(
      <MarkdownPreview
        allowHtml
        content={`\`${dateToken}\`\n\n\`\`\`text\n${dateToken}\n\`\`\``}
      />,
    );

    expect(
      Array.from(
        container.querySelectorAll("code"),
        (code) => code.textContent,
      ),
    ).toEqual([dateToken, dateToken]);
  });

  it("renders a standalone token without interpreting fallback as Markdown", () => {
    const { container } = render(
      <MarkdownPreview
        allowHtml
        content="<!date^1700000000^{date_short}|A &amp; **B**>"
      />,
    );

    expect(container.textContent).toBe("A & **B**");
    expect(container.querySelector("strong")).toBeNull();
  });

  it.each([
    `<div title="${dateToken}">Ready</div>`,
    `<!--${dateToken}-->Ready`,
    `<script>${dateToken}</script>Ready`,
  ])("keeps non-visible HTML content non-visible: %s", (content) => {
    const { container } = render(
      <MarkdownPreview allowHtml content={content} />,
    );

    expect(container.textContent).toBe("Ready");
    expect(container.querySelector("script")).toBeNull();
  });
});

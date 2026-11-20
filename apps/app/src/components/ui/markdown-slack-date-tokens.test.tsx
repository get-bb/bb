// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { LazyMarkdownHtml } from "./lazy-markdown-html";
import { MarkdownPreview } from "./markdown-preview";
import { formatSlackDateToken } from "./markdown-slack-date-tokens";

const START =
  "<!date^1794667200^{date_short_pretty} {time}|2026-11-14 14:40 UTC>";
const END =
  "<!date^1794671400^{date_short_pretty} {time}|2026-11-14 15:50 UTC>";

beforeAll(() => LazyMarkdownHtml.preload());

afterEach(() => {
  cleanup();
});

describe("formatSlackDateToken", () => {
  it("reads the timestamp and format of a date token", () => {
    expect(formatSlackDateToken(START)).toBe("2026-11-14 14:40 UTC");
    expect(
      formatSlackDateToken(
        "<!date^1793225255^{date_short_pretty} {time_secs}|2026-10-28 22:07:35 UTC>",
      ),
    ).toBe("2026-10-28 22:07:35 UTC");
  });

  it("ignores the fallback, which can drop the date", () => {
    expect(
      formatSlackDateToken(
        "<!date^1794667200^{date_short_pretty} {time}|17:15 UTC>",
      ),
    ).toBe("2026-11-14 14:40 UTC");
  });

  it("leaves a date-only token without a time", () => {
    expect(
      formatSlackDateToken(
        "<!date^1793920977^{date_short_pretty}|2026-11-05 UTC>",
      ),
    ).toBe("2026-11-05");
  });

  it("accepts a linked date token", () => {
    expect(
      formatSlackDateToken(
        "<!date^1794667200^{date_short_pretty} {time}^https://example.com|2026-11-14 14:40 UTC>",
      ),
    ).toBe("2026-11-14 14:40 UTC");
  });

  it("rejects other HTML nodes and unusable timestamps", () => {
    for (const token of [
      "<b>",
      "</b>",
      "<!-- a comment -->",
      "<!channel>",
      "<!date^abc^{date_short_pretty}|x>",
      "<!date^99999999999999999^{date_short_pretty}|x>",
      "<!date^1794667200^|2026-11-14 14:40 UTC>",
    ]) {
      expect(formatSlackDateToken(token)).toBeNull();
    }
  });
});

describe("MarkdownPreview with Slack date tokens", () => {
  it("shows the dates of an HTML message", () => {
    const { container } = render(
      <MarkdownPreview
        content={`logs between ${START} and ${END}, then a <b>bold</b> word`}
        allowHtml
      />,
    );
    expect(container.textContent).toContain(
      "logs between 2026-11-14 14:40 UTC and 2026-11-14 15:50 UTC, then a",
    );
    expect(container.textContent).not.toContain("<!date");
    expect(container.querySelector("b")?.textContent).toBe("bold");
  });

  it("shows the dates of a plain message", () => {
    const { container } = render(
      <MarkdownPreview content={`logs between ${START} and ${END}`} />,
    );
    expect(container.textContent).toBe(
      "logs between 2026-11-14 14:40 UTC and 2026-11-14 15:50 UTC",
    );
  });

  it("keeps a date token literal inside code", () => {
    const { container } = render(
      <MarkdownPreview
        content={`Use \`${START}\` in the query\n\n\`\`\`\n${END}\n\`\`\`\n`}
      />,
    );
    expect(container.textContent).toContain(START);
    expect(container.textContent).toContain(END);
  });
});

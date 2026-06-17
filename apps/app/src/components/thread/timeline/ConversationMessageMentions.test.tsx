// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  messageBodyHasQuote,
  renderMessageBodyWithQuotes,
} from "./ConversationMessageMentions";

afterEach(() => {
  cleanup();
});

describe("messageBodyHasQuote", () => {
  it("detects blockquote lines", () => {
    expect(messageBodyHasQuote("> quoted")).toBe(true);
    expect(messageBodyHasQuote("reply\n> quoted")).toBe(true);
    expect(messageBodyHasQuote(">")).toBe(true);
    expect(messageBodyHasQuote("just text")).toBe(false);
    expect(messageBodyHasQuote("a > b is not a quote")).toBe(false);
  });
});

describe("renderMessageBodyWithQuotes", () => {
  it("renders a blockquote (prefix stripped) followed by a reply paragraph", () => {
    const { container } = render(
      <>
        {renderMessageBodyWithQuotes({
          mentions: [],
          text: "> first line\n> second line\nmy reply",
        })}
      </>,
    );

    const quote = container.querySelector("blockquote");
    expect(quote?.textContent).toBe("first line\nsecond line");

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe("my reply");
  });

  it("keeps two separate quotes as separate blockquotes", () => {
    const { container } = render(
      <>
        {renderMessageBodyWithQuotes({
          mentions: [],
          text: "> a\n\n> b",
        })}
      </>,
    );
    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
  });
});

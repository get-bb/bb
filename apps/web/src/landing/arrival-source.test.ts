import { describe, expect, it } from "vitest";

import { classifyArrivalSource } from "./arrival-source";

function classify(search: string, referrer: string) {
  return classifyArrivalSource(new URLSearchParams(search), referrer);
}

describe("classifyArrivalSource", () => {
  it("returns share for utm_medium=share", () => {
    expect(classify("?utm_medium=share", "")).toBe("share");
  });

  it("prefers share over a social referrer", () => {
    expect(classify("?utm_medium=share", "https://t.co/abc123")).toBe("share");
    expect(classify("?utm_medium=share", "https://x.com/someone")).toBe(
      "share",
    );
  });

  it("returns search for search engine referrers and their subdomains", () => {
    expect(classify("", "https://www.google.com/")).toBe("search");
    expect(classify("", "https://www.google.co.uk/")).toBe("search");
    expect(classify("", "https://google.de/")).toBe("search");
    expect(classify("", "https://www.bing.com/search?q=bb")).toBe("search");
    expect(classify("", "https://duckduckgo.com/")).toBe("search");
  });

  it("returns social for social referrers and their subdomains", () => {
    expect(classify("", "https://m.youtube.com/watch?v=1")).toBe("social");
    expect(classify("", "https://old.reddit.com/r/bb")).toBe("social");
    expect(classify("", "https://news.ycombinator.com/item?id=1")).toBe(
      "social",
    );
    expect(classify("", "https://www.linkedin.com/")).toBe("social");
    expect(classify("", "https://discord.com/channels/1")).toBe("social");
    expect(classify("", "https://twitter.com/")).toBe("social");
  });

  it("returns direct when there is no referrer", () => {
    expect(classify("", "")).toBe("direct");
    expect(classify("?utm_medium=email", "")).toBe("direct");
  });

  it("returns other for unknown referrers", () => {
    expect(classify("", "https://example.com/blog")).toBe("other");
    expect(classify("", "https://linux.com/")).toBe("other");
    expect(classify("", "https://google.example.com/")).toBe("other");
    expect(classify("", "https://ycombinator.com/")).toBe("other");
  });

  it("returns other for an unparseable referrer", () => {
    expect(classify("", "not a url")).toBe("other");
  });
});

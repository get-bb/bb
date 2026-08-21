import { describe, expect, it } from "vitest";

import { parsePost, stripMarkdown } from "./parse-post";

const SAMPLE = `---
title: An Agentic IDE That Builds Itself
date: 2026-08-05
lede: I'm excited to show **bb**.
sourceLabel: This post first appeared as an X Article
sourceHref: https://x.com/sawyerhood/status/2085039905529597982
---

This started as a passion project.

tweet:https://x.com/brian_lovin/status/2084345751266857079

## No Two Installs Look Alike

Here is **bb** the first time you open it:

![bb the first time you open it](/blog/first-open.jpg)
*Threads on the left!*

- **A task system.** Agents can read issues.
- **A DAW.** Music inside the IDE
  with Strudel.

[![A DAW](/blog/daw.jpg)](https://x.com/sawyerhood/status/2085039905529597982)
`;

describe("parsePost", () => {
  it("reads front matter and the body shapes the blog uses", () => {
    const post = parsePost("an-agentic-ide-that-builds-itself", SAMPLE);
    expect(post.slug).toBe("an-agentic-ide-that-builds-itself");
    expect(post.title).toBe("An Agentic IDE That Builds Itself");
    expect(post.dateIso).toBe("2026-08-05");
    expect(post.date).toBe("August 5, 2026");
    expect(post.lede).toBe("I'm excited to show **bb**.");
    expect(post.sourceHref).toContain("x.com/sawyerhood");
    expect(post.cover).toEqual({
      src: "/blog/first-open.jpg",
      alt: "bb the first time you open it",
    });
    expect(post.blocks).toEqual([
      { kind: "paragraph", text: "This started as a passion project." },
      {
        kind: "tweet",
        href: "https://x.com/brian_lovin/status/2084345751266857079",
        id: "2084345751266857079",
      },
      { kind: "heading", text: "No Two Installs Look Alike" },
      {
        kind: "paragraph",
        text: "Here is **bb** the first time you open it:",
      },
      {
        kind: "image",
        src: "/blog/first-open.jpg",
        alt: "bb the first time you open it",
        caption: "Threads on the left!",
      },
      {
        kind: "list",
        items: [
          "**A task system.** Agents can read issues.",
          "**A DAW.** Music inside the IDE with Strudel.",
        ],
      },
      {
        kind: "image",
        src: "/blog/daw.jpg",
        alt: "A DAW",
        href: "https://x.com/sawyerhood/status/2085039905529597982",
      },
    ]);
  });

  it("prefers coverSrc over the first body image", () => {
    const post = parsePost(
      "cover",
      `---
title: Cover
date: 2026-08-05
lede: Hi
coverSrc: /blog/header.png
coverAlt: Header
---

![body](/blog/body.jpg)
`,
    );
    expect(post.cover).toEqual({ src: "/blog/header.png", alt: "Header" });
  });

  it("keeps a javascript image src as a paragraph", () => {
    const post = parsePost(
      "safe",
      `---
title: Safe
date: 2026-08-05
lede: Hi
---

![x](javascript:alert(1))
`,
    );
    expect(post.blocks).toEqual([
      { kind: "paragraph", text: "![x](javascript:alert(1))" },
    ]);
  });
});

describe("stripMarkdown", () => {
  it("drops markers so the lede can go in a meta tag", () => {
    expect(stripMarkdown("I'm excited to show **bb**, an [IDE](/).")).toBe(
      "I'm excited to show bb, an IDE.",
    );
  });
});

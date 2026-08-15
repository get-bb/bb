import { describe, expect, it } from "vitest";

import { getPost, POSTS } from "./posts";

describe("POSTS", () => {
  it("ships the bb launch post at the top", () => {
    expect(POSTS.length).toBeGreaterThan(0);
    const [latest] = POSTS;
    expect(latest.slug).toBe("an-agentic-ide-that-builds-itself");
    expect(getPost(latest.slug)?.title).toBe(
      "An Agentic IDE That Builds Itself",
    );
    expect(latest.blocks.some((block) => block.kind === "image")).toBe(true);
  });
});

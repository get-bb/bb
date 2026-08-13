import { describe, expect, it } from "vitest";

import { getImageSize } from "./image-sizes";
import { POSTS } from "./posts";

describe("getImageSize", () => {
  it("records a size for every post image", () => {
    const sources = POSTS.flatMap((post) => [
      ...(post.cover ? [post.cover.src] : []),
      ...post.blocks
        .filter((block) => block.kind === "image")
        .map((block) => block.src),
    ]);
    expect(sources.length).toBeGreaterThan(0);
    const missing = sources.filter((src) => !getImageSize(src));
    expect(missing).toEqual([]);
  });
});

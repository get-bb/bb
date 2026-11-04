import { describe, it } from "vitest";
import { pathological } from "@/test/fixtures/streaming-markdown/pathological";
import { expectStreamedFixtureMatchesWholeDocument } from "./markdown-incremental-pieces-test-helpers";

describe("resolveMarkdownPieces", () => {
  it.each([{ name: "pathological", text: pathological }])(
    "matches single documents for every streamed chunk of the $name fixture",
    expectStreamedFixtureMatchesWholeDocument,
    60_000,
  );
});

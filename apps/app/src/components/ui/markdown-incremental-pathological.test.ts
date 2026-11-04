import { it } from "vitest";
import { pathological } from "@/test/fixtures/streaming-markdown/pathological";
import { expectStreamedFixtureMatchesWholeDocument } from "./markdown-incremental-pieces-test-helpers";

it("matches single documents for every streamed chunk of the pathological fixture", () => {
  expectStreamedFixtureMatchesWholeDocument({
    name: "pathological",
    text: pathological,
  });
}, 60_000);

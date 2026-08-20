import { describe, expect, it } from "vitest";
import { composeSeedFromShareIntent } from "./share-intent";

describe("composeSeedFromShareIntent", () => {
  it("seeds the prompt with shared text", () => {
    expect(
      composeSeedFromShareIntent({ type: "text", text: "  fix the build  " }),
    ).toEqual({ initialPrompt: "fix the build" });
  });

  it("puts a web URL after the text and never repeats it", () => {
    expect(
      composeSeedFromShareIntent({
        type: "weburl",
        text: "Look at this",
        webUrl: "https://example.com/x",
      }),
    ).toEqual({ initialPrompt: "Look at this\n\nhttps://example.com/x" });
    expect(
      composeSeedFromShareIntent({
        type: "weburl",
        text: "https://example.com/x",
        webUrl: "https://example.com/x",
      }),
    ).toEqual({ initialPrompt: "https://example.com/x" });
  });

  it("rejects media / file shares and empty payloads", () => {
    expect(
      composeSeedFromShareIntent({
        type: "media",
        files: [{ path: "/tmp/a.png", mimeType: "image/png" }],
      }),
    ).toBeNull();
    expect(
      composeSeedFromShareIntent({ type: "text", text: "   " }),
    ).toBeNull();
  });
});

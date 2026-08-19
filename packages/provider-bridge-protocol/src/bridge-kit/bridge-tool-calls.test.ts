import { describe, expect, it } from "vitest";
import {
  buildBridgeToolCallContent,
  decodeToolCallResponsePayload,
} from "./bridge-tool-calls.js";

const PNG = "iVBORw0KGgo=";

describe("decodeToolCallResponsePayload", () => {
  it("keeps text results unchanged", () => {
    expect(
      decodeToolCallResponsePayload({
        success: true,
        contentItems: [
          { type: "inputText", text: "first" },
          { type: "inputText", text: "second" },
        ],
      }),
    ).toEqual({ content: "first\nsecond", images: [], isError: false });
  });

  // The bug: an image-only result decoded to the literal "OK" with the image
  // dropped, so browser_screenshot reported success and returned nothing.
  it("decodes an image-only result into an image rather than OK", () => {
    expect(
      decodeToolCallResponsePayload({
        success: true,
        contentItems: [
          { type: "inputImage", imageUrl: `data:image/png;base64,${PNG}` },
        ],
      }),
    ).toEqual({
      content: "",
      images: [{ data: PNG, mimeType: "image/png" }],
      isError: false,
    });
  });

  it("keeps both halves of a mixed text and image result", () => {
    expect(
      decodeToolCallResponsePayload({
        success: true,
        contentItems: [
          { type: "inputText", text: "captured" },
          { type: "inputImage", imageUrl: `data:image/jpeg;base64,${PNG}` },
        ],
      }),
    ).toEqual({
      content: "captured",
      images: [{ data: PNG, mimeType: "image/jpeg" }],
      isError: false,
    });
  });

  it("reports an image result that failed as an error", () => {
    expect(
      decodeToolCallResponsePayload({
        success: false,
        contentItems: [
          { type: "inputImage", imageUrl: `data:image/png;base64,${PNG}` },
        ],
      }).isError,
    ).toBe(true);
  });

  // A tool result contract carries inline base64 only, so a remote reference
  // has to survive as text; dropping it is what this fix exists to stop.
  it("keeps a non-data image url as text", () => {
    expect(
      decodeToolCallResponsePayload({
        success: true,
        contentItems: [
          { type: "inputImage", imageUrl: "https://example.com/a.png" },
        ],
      }),
    ).toEqual({
      content: "https://example.com/a.png",
      images: [],
      isError: false,
    });
  });

  it("keeps a data url with an empty payload as text", () => {
    expect(
      decodeToolCallResponsePayload({
        success: true,
        contentItems: [
          { type: "inputImage", imageUrl: "data:image/png;base64," },
        ],
      }),
    ).toEqual({
      content: "data:image/png;base64,",
      images: [],
      isError: false,
    });
  });

  it("falls back to OK only when there is neither text nor image", () => {
    expect(
      decodeToolCallResponsePayload({ success: true, contentItems: [] }),
    ).toEqual({ content: "OK", images: [], isError: false });
    expect(decodeToolCallResponsePayload({ nope: true })).toEqual({
      content: "OK",
      images: [],
      isError: false,
    });
  });
});

describe("buildBridgeToolCallContent", () => {
  it("emits an image block alone when there is no text", () => {
    expect(
      buildBridgeToolCallContent({
        content: "",
        images: [{ data: PNG, mimeType: "image/png" }],
      }),
    ).toEqual([{ type: "image", data: PNG, mimeType: "image/png" }]);
  });

  it("keeps text first when a result carries both", () => {
    expect(
      buildBridgeToolCallContent({
        content: "captured",
        images: [{ data: PNG, mimeType: "image/png" }],
      }),
    ).toEqual([
      { type: "text", text: "captured" },
      { type: "image", data: PNG, mimeType: "image/png" },
    ]);
  });

  it("emits a lone text block for a text result", () => {
    expect(buildBridgeToolCallContent({ content: "OK", images: [] })).toEqual([
      { type: "text", text: "OK" },
    ]);
  });

  // The pending-call failure paths resolve without an images key.
  it("tolerates a result with no images key", () => {
    expect(buildBridgeToolCallContent({ content: "transport closed" })).toEqual(
      [{ type: "text", text: "transport closed" }],
    );
  });
});

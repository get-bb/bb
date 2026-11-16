import { describe, expect, it } from "vitest";
import {
  buildGrokInterjectParams,
  decodeGrokInterjectResult,
} from "./grok-queue.js";

describe("Grok interject adapter", () => {
  it("builds the live double-wrapped method params with exact text", () => {
    const text = "First line\nمراجعة 😀\nSecond line";
    expect(buildGrokInterjectParams({ sessionId: "session-1", text })).toEqual({
      sessionId: "session-1",
      text,
    });
  });

  it("preserves large input instead of inventing a second text quota", () => {
    const text = "x".repeat(64_001);
    expect(buildGrokInterjectParams({ sessionId: "s", text }).text).toBe(text);
  });

  it("rejects empty and blank text that Grok would accept as a no-op", () => {
    for (const text of ["", " ", "\n\t  "]) {
      expect(() =>
        buildGrokInterjectParams({ sessionId: "session-1", text }),
      ).toThrow(/text|blank/i);
    }
    expect(() =>
      buildGrokInterjectParams({ sessionId: "", text: "x" }),
    ).toThrow(/sessionId/i);
  });

  it("decodes only the observed queued acknowledgement and tolerates future fields", () => {
    expect(
      decodeGrokInterjectResult({
        result: { status: "queued", future: true },
        futureEnvelope: true,
      }),
    ).toEqual({ status: "queued" });
  });

  it("rejects malformed or negative acknowledgements instead of reporting delivery", () => {
    for (const result of [
      {},
      { status: "queued" },
      { result: {} },
      { result: { status: "failed" } },
      { result: { status: "queued", extra: null }, error: "failed" },
    ]) {
      expect(() => decodeGrokInterjectResult(result)).toThrow(
        /interject|queued|result|expected|invalid/i,
      );
    }
  });
});

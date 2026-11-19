import { describe, expect, it } from "vitest";
import { normalizeInteractionRequest } from "./host-policy.js";

describe("interaction request payload validation", () => {
  it.each([
    "encoding failed",
    "encoding failed at 64 KiB",
    "ui.requestInput payload exceeds 64 KiB",
  ])(
    "normalizes serialization failures regardless of their message: %s",
    (message) => {
      expect(() =>
        normalizeInteractionRequest({
          threadId: "thread-test",
          rendererId: "form",
          title: "Form",
          payload: {
            get value(): string {
              throw new Error(message);
            },
          },
        }),
      ).toThrow(new Error("ui.requestInput payload must be JSON-serializable"));
    },
  );

  it("accepts exactly 64 KiB of JSON and rejects larger UTF-8 payloads", () => {
    const request = {
      threadId: "thread-test",
      rendererId: "form",
      title: "Form",
      payload: "a".repeat(65_534),
    };

    expect(normalizeInteractionRequest(request).payload).toBe(request.payload);
    expect(() =>
      normalizeInteractionRequest({
        ...request,
        payload: `${request.payload}a`,
      }),
    ).toThrow(new Error("ui.requestInput payload exceeds 64 KiB"));
    expect(() =>
      normalizeInteractionRequest({
        ...request,
        payload: "\u20ac".repeat(21_845),
      }),
    ).toThrow(new Error("ui.requestInput payload exceeds 64 KiB"));
  });
});

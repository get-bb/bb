import { describe, expect, it } from "vitest";
import { normalizeInteractionRequest } from "../internal/host-policy.js";

const baseRequest = {
  threadId: "thread-1",
  rendererId: "form",
  title: "Input",
};

describe("normalizeInteractionRequest", () => {
  it("does not mistake a serialization error mentioning the size limit for an oversized payload", () => {
    const payload = {
      toJSON() {
        throw new Error("serializer failed near 64 KiB");
      },
    } as unknown as Parameters<typeof normalizeInteractionRequest>[0]["payload"];

    expect(() => normalizeInteractionRequest({ ...baseRequest, payload })).toThrow(
      "ui.requestInput payload must be JSON-serializable",
    );
  });

  it("keeps the size-limit error for a serializable oversized payload", () => {
    expect(() =>
      normalizeInteractionRequest({
        ...baseRequest,
        payload: "a".repeat(65 * 1024),
      }),
    ).toThrow("ui.requestInput payload exceeds 64 KiB");
  });
});

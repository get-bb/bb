import { describe, expect, it, vi } from "vitest";
import { createSentMessageEditOperationId } from "./sent-message-edit-operation-id";

describe("createSentMessageEditOperationId", () => {
  it("does not require crypto.randomUUID", () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
      randomUUID: undefined,
      subtle: originalCrypto.subtle,
    });

    try {
      const first = createSentMessageEditOperationId();
      const second = createSentMessageEditOperationId();

      expect(first).not.toBe(second);
      expect(first.length).toBeGreaterThan(0);
    } finally {
      vi.stubGlobal("crypto", originalCrypto);
    }
  });
});

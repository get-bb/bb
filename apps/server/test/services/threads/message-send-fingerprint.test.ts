import { describe, expect, it } from "vitest";
import {
  fingerprintMessageSendRequest,
  MESSAGE_SEND_REQUEST_FINGERPRINT_FORMAT_VERSION,
  type MessageSendRequestFingerprintIntent,
} from "../../../src/services/threads/message-send-fingerprint.js";

function baseIntent(
  overrides: Partial<MessageSendRequestFingerprintIntent> = {},
): MessageSendRequestFingerprintIntent {
  return {
    input: [{ type: "text", text: "hello", mentions: [] }],
    model: "gpt-5",
    permissionMode: "full",
    reasoningLevel: "medium",
    serviceTier: "default",
    ...overrides,
  };
}

describe("fingerprintMessageSendRequest", () => {
  it("is stable across object key insertion order", () => {
    const left = fingerprintMessageSendRequest({
      serviceTier: "default",
      model: "gpt-5",
      input: [{ mentions: [], type: "text", text: "hello" }],
      reasoningLevel: "medium",
      permissionMode: "full",
      executionInputSources: {
        permissionMode: "explicit",
        model: "explicit",
      },
      senderThreadId: "thr_sender",
    });
    const right = fingerprintMessageSendRequest({
      senderThreadId: "thr_sender",
      executionInputSources: {
        model: "explicit",
        permissionMode: "explicit",
      },
      permissionMode: "full",
      reasoningLevel: "medium",
      input: [{ type: "text", text: "hello", mentions: [] }],
      model: "gpt-5",
      serviceTier: "default",
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("treats omitted and undefined optional fields as equivalent", () => {
    const omitted = fingerprintMessageSendRequest({
      input: [{ type: "text", text: "hello", mentions: [] }],
    });
    const explicitUndefined = fingerprintMessageSendRequest({
      input: [{ type: "text", text: "hello", mentions: [] }],
      model: undefined,
      serviceTier: undefined,
      reasoningLevel: undefined,
      permissionMode: undefined,
      executionInputSources: undefined,
      senderThreadId: undefined,
    });
    const nestedUndefined = fingerprintMessageSendRequest({
      input: [{ type: "text", text: "hello", mentions: [] }],
      executionInputSources: {
        model: undefined,
        serviceTier: undefined,
      },
    });

    expect(omitted).toBe(explicitUndefined);
    expect(nestedUndefined).toBe(omitted);
  });

  it("changes when semantic intent changes", () => {
    const base = fingerprintMessageSendRequest(baseIntent());
    expect(
      fingerprintMessageSendRequest(baseIntent({ model: "gpt-4.1" })),
    ).not.toBe(base);
    expect(
      fingerprintMessageSendRequest(
        baseIntent({
          input: [{ type: "text", text: "goodbye", mentions: [] }],
        }),
      ),
    ).not.toBe(base);
    expect(
      fingerprintMessageSendRequest(
        baseIntent({ senderThreadId: "thr_other" }),
      ),
    ).not.toBe(base);
    expect(
      fingerprintMessageSendRequest(
        baseIntent({
          executionInputSources: { model: "client-preference" },
        }),
      ),
    ).not.toBe(base);
  });

  it("embeds the fingerprint format version in the digest", () => {
    expect(MESSAGE_SEND_REQUEST_FINGERPRINT_FORMAT_VERSION).toBe(1);
    const withInput = fingerprintMessageSendRequest({
      input: [{ type: "text", text: "versioned", mentions: [] }],
    });
    expect(
      fingerprintMessageSendRequest({
        input: [{ type: "text", text: "other", mentions: [] }],
      }),
    ).not.toBe(withInput);
  });
});

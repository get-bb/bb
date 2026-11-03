import { expect, it } from "vitest";
import { experimental_createDeltaAssembler as createDeltaAssembler } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { createPiDeltaTranslator } from "./delta-translation.js";

it.each([
  ["529 capacity exhausted", "overloaded", 529],
  ["503 upstream overloaded", "overloaded", 503],
  ["HTTP 500 Internal Server Error", "internal", 500],
  ["Compaction failed: Summarization failed: 504", "internal", 504],
  ["429 Too Many Requests", "rate-limit", 429],
  ["rate_limit_error", "rate-limit", null],
  ["401 Unauthorized: overloaded", "unauthorized", 401],
  ["403 Forbidden", "unauthorized", 403],
  ["invalid api key", "unauthorized", null],
  ["402 Payment Required", "billing", 402],
  ["400 context_length_exceeded", "context-window-exceeded", 400],
  ["prompt is too long", "context-window-exceeded", null],
  ["408 Request Timeout", "connection-failed", 408],
  ["read ECONNRESET", "connection-failed", null],
  ["turn/start timed out", "connection-failed", null],
  ["fetch failed", "connection-failed", null],
  ["422 invalid request", "bad-request", 422],
  ["socket hang up", "connection-failed", null],
  ["terminated", "connection-failed", null],
  ["Connection error.", "connection-failed", null],
  ["Service Unavailable", "connection-failed", null],
  ["Anthropic stream ended before message_stop", "connection-failed", null],
  [
    "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
    "context-window-exceeded",
    null,
  ],
  [
    "429 You exceeded your current quota: insufficient_quota",
    "billing",
    429,
  ],
  ["Monthly usage limit reached", "unknown", null],
  ["unrecognized failure", "unknown", null],
])(
  "classifies Pi failure %s",
  (detail, category, httpStatusCode) => {
    const translator = createPiDeltaTranslator({
      resolveModelContextWindow: () => null,
    });
    expect(
      translator.translate({
        jsonrpc: "2.0",
        method: "error",
        params: { message: detail },
      }),
    ).toContainEqual(
      expect.objectContaining({
        kind: "provider.error",
        detail,
        errorInfo: { category, httpStatusCode, providerCode: null },
      }),
    );
  },
);

const message = "502 Bad Gateway";
const assistant = {
  role: "assistant",
  content: [],
  stopReason: "error",
  errorMessage: message,
};

it.each([
  { jsonrpc: "2.0", method: "error", params: { message } },
  { type: "agent_end", messages: [assistant] },
  { type: "agent_end", messages: [assistant], willRetry: true },
  {
    type: "agent_end",
    messages: [assistant],
    deferSettlement: true,
    settlementSuperseded: true,
  },
  {
    type: "compaction_end",
    reason: "overflow",
    aborted: false,
    errorMessage: message,
  },
])("preserves actionable Pi failure information for $type $method", (event) => {
  const translator = createPiDeltaTranslator({
    resolveModelContextWindow: () => null,
  });
  const assembler = createDeltaAssembler({ providerId: "pi" });
  assembler.assemble({
    threadId: "error-test",
    deltas: translator.translate({ type: "agent_start" }),
  });
  const events = assembler.assemble({
    threadId: "error-test",
    deltas: translator.translate(event),
  });
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "provider/error",
      errorInfo: {
        category: "internal",
        httpStatusCode: 502,
        providerCode: null,
      },
      detail: message,
    }),
  );
});

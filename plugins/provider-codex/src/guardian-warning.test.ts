import { describe, expect, it } from "vitest";
import { experimental_createDeltaAssembler as createDeltaAssembler } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { createCodexEventTranslator } from "./translator.js";
import { threadScope } from "./event-scope.test-support.js";

function translate(params: Record<string, unknown>) {
  const translator = createCodexEventTranslator({
    additionalWorkspaceWriteRoots: [],
  });
  const assembler = createDeltaAssembler({
    providerId: "codex",
    entropyPrefix: "guardian-test",
    textDeltaFlushMs: 0,
  });
  return assembler.assemble({
    threadId: "guardian-test-thread",
    deltas: translator.translateEvent({
      jsonrpc: "2.0",
      method: "guardianWarning",
      params,
    }),
  });
}

describe("Codex guardian warning translation", () => {
  it("preserves the review message as a warning instead of raw diagnostics", () => {
    expect(
      translate({
        threadId: "provider-thread",
        message: "Review completed for a read-only operation.",
      }),
    ).toEqual([
      expect.objectContaining({
        type: "provider/warning",
        category: "general",
        summary: "Review completed for a read-only operation.",
        scope: threadScope(),
      }),
    ]);
  });

  it.each([
    { threadId: "provider-thread" },
    { threadId: "provider-thread", message: 42 },
    { message: "Review completed for a read-only operation." },
  ])("keeps malformed notifications visible as diagnostics: %j", (params) => {
    expect(translate(params)).toEqual([
      expect.objectContaining({
        type: "provider/unhandled",
        rawType: "guardianWarning",
      }),
    ]);
  });
});

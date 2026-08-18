// Classification invariants for `isStandaloneBuiltinCompactCommand`.
//
// These cases moved here from the legacy Codex adapter suite
// (`plugins/provider-codex/src/adapter.test.ts`) when that adapter was
// deleted. The function is shared with the canonical Codex bridge, which uses
// it to route a standalone builtin `/compact` prompt to `thread/compact/start`
// instead of `turn/start`; that routing decision is covered by the codex bridge
// tests, while these cases pin classification only.

import { describe, expect, it } from "vitest";

import { isStandaloneBuiltinCompactCommand } from "../src/shared-types.js";
import type { PromptInput, PromptMentionCommandOrigin } from "../src/index.js";

function promptCompactCommandInput(args?: {
  origin?: PromptMentionCommandOrigin;
  text?: string;
}): PromptInput {
  const text = args?.text ?? "/compact";
  const start = text.indexOf("/compact");
  if (start === -1) {
    throw new Error(`Missing /compact command text in "${text}".`);
  }
  return {
    type: "text",
    text,
    mentions: [
      {
        start,
        end: start + "/compact".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "compact",
          source: "command",
          origin: args?.origin ?? "builtin",
          label: "compact",
          argumentHint: null,
        },
      },
    ],
  };
}

function promptTextInput(text: string): PromptInput {
  return { type: "text", text, mentions: [] };
}

describe("isStandaloneBuiltinCompactCommand", () => {
  it("classifies a standalone builtin /compact mention as a compact command", () => {
    expect(
      isStandaloneBuiltinCompactCommand([promptCompactCommandInput()]),
    ).toBe(true);
  });

  it("does not classify raw /compact text as a compact command", () => {
    expect(
      isStandaloneBuiltinCompactCommand([promptTextInput("/compact")]),
    ).toBe(false);
  });

  it("does not classify user-origin compact commands as a compact command", () => {
    expect(
      isStandaloneBuiltinCompactCommand([
        promptCompactCommandInput({ origin: "user" }),
      ]),
    ).toBe(false);
  });

  it("does not classify mixed compact command input as a compact command", () => {
    expect(
      isStandaloneBuiltinCompactCommand([
        promptCompactCommandInput({ text: "/compact then summarize" }),
      ]),
    ).toBe(false);
  });
});

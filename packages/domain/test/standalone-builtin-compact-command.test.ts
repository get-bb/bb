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

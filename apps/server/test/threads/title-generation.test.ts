import { describe, expect, it } from "vitest";
import type { PromptInput } from "@bb/domain";
import {
  collectInvokedPromptCommands,
  deriveTitleFallback,
  sanitizeGeneratedTitle,
  shouldGenerateThreadTitle,
} from "../../src/services/threads/title-generation.js";

function textInput(text: string): PromptInput {
  return {
    type: "text",
    text,
    mentions: [],
  };
}

function skillInput(name: string, rest = ""): PromptInput {
  const command = `/${name}`;
  return {
    type: "text",
    text: `${command}${rest}`,
    mentions: [
      {
        start: 0,
        end: command.length,
        resource: {
          kind: "command",
          trigger: "/",
          name,
          source: "skill",
          origin: "user",
          label: name,
          argumentHint: null,
        },
      },
    ],
  };
}

describe("thread title generation", () => {
  it("does not generate titles for inputs shorter than five words", () => {
    expect(shouldGenerateThreadTitle([textInput("fix")])).toBe(false);
    expect(shouldGenerateThreadTitle([textInput("fix bug")])).toBe(false);
    expect(shouldGenerateThreadTitle([textInput("fix the bug")])).toBe(false);
    expect(shouldGenerateThreadTitle([textInput("fix the login bug")])).toBe(
      false,
    );
  });

  it("generates titles for inputs with at least five words", () => {
    expect(
      shouldGenerateThreadTitle([textInput("fix the flaky login bug")]),
    ).toBe(true);
  });

  it("counts words across text input parts and ignores attachments", () => {
    const input: PromptInput[] = [
      textInput("fix the flaky"),
      {
        type: "localFile",
        path: "/tmp/error.log",
      },
      textInput("login bug"),
    ];

    expect(shouldGenerateThreadTitle(input)).toBe(true);
  });

  it("limits generated titles to five words", () => {
    expect(
      sanitizeGeneratedTitle(
        "Investigate Extremely Long Generated Thread Title Output",
      ),
    ).toBe("Investigate Extremely Long Generated Thread");
  });

  it("returns null for empty generated titles", () => {
    expect(sanitizeGeneratedTitle("   ")).toBeNull();
  });

  it("generates titles for invoked skills regardless of prompt length", () => {
    expect(shouldGenerateThreadTitle([skillInput("sync-repo")])).toBe(true);
    expect(
      shouldGenerateThreadTitle([skillInput("sync-repo", " then deploy")]),
    ).toBe(true);
  });

  it("keeps the raw command text as the fallback for invoked skills", () => {
    expect(deriveTitleFallback([skillInput("sync-repo", " then deploy")])).toBe(
      "/sync-repo then deploy",
    );
  });

  it("collects each invoked command once, in prompt order", () => {
    expect(
      collectInvokedPromptCommands([
        skillInput("sync-repo"),
        textInput("then"),
        skillInput("review-diff"),
        skillInput("sync-repo"),
      ]),
    ).toEqual([
      { name: "sync-repo", trigger: "/" },
      { name: "review-diff", trigger: "/" },
    ]);
  });

  it("keeps fallback derivation independent from title generation eligibility", () => {
    const input = [textInput("fix bug")];

    expect(deriveTitleFallback(input)).toBe("fix bug");
    expect(shouldGenerateThreadTitle(input)).toBe(false);
  });
});

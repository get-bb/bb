import { describe, expect, it } from "vitest";
import type { PromptInput } from "@bb/domain";
import {
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

describe("thread title generation", () => {
  it("uses thread mention labels in handoff fallback titles", () => {
    const text = "Continue from @thread:thr_source";
    const input: PromptInput[] = [
      {
        type: "text",
        text,
        mentions: [
          {
            start: "Continue from ".length,
            end: text.length,
            resource: {
              kind: "thread",
              projectId: "proj_test",
              threadId: "thr_source",
              label: "Fix login",
            },
          },
        ],
      },
    ];

    expect(deriveTitleFallback(input)).toBe("Continue from Fix login");
    expect(shouldGenerateThreadTitle(input)).toBe(false);
    expect(input[0]).toMatchObject({ text });
  });

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

  it("keeps fallback derivation independent from title generation eligibility", () => {
    const input = [textInput("fix bug")];

    expect(deriveTitleFallback(input)).toBe("fix bug");
    expect(shouldGenerateThreadTitle(input)).toBe(false);
  });
});

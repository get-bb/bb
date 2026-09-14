import { describe, expect, it } from "vitest";
import type { Question } from "@bb/shared-ui/question-form-state";
import { resolveQuestionShortcutChoice } from "@bb/shared-ui/question-form-state";

const question: Question = {
  id: "question-1",
  shortLabel: "Path",
  prompt: "Choose a path",
  multiSelect: false,
  options: [
    { value: "fast", label: "Fast" },
    { value: "safe", label: "Safe" },
  ],
  allowFreeText: true,
};

describe("resolveQuestionShortcutChoice", () => {
  it("maps rendered option order and the trailing Other choice", () => {
    expect(resolveQuestionShortcutChoice(question, 0)).toEqual({
      kind: "option",
      value: "fast",
    });
    expect(resolveQuestionShortcutChoice(question, 2)).toEqual({
      kind: "other",
    });
    expect(resolveQuestionShortcutChoice(question, 3)).toBeNull();
  });
});

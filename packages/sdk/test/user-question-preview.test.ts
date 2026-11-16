import type { PendingInteractionUserQuestionQuestion } from "@bb/domain";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("SDK user-question payloads", () => {
  it("exposes provider-neutral option previews", () => {
    const question: PendingInteractionUserQuestionQuestion = {
      id: "question-1",
      prompt: "Choose",
      multiSelect: false,
      allowFreeText: false,
      required: true,
      options: [
        {
          value: "Alpha",
          label: "Alpha",
          preview: "PREVIEW_ALPHA",
        },
      ],
    };

    expectTypeOf(question.options?.[0]?.preview).toEqualTypeOf<
      string | undefined
    >();
    expect(question.options?.[0]?.preview).toBe("PREVIEW_ALPHA");
  });
});

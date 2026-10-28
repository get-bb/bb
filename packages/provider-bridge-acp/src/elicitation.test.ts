import { describe, expect, it } from "vitest";
import { planAcpElicitation } from "./elicitation.js";

function form(
  properties: Record<string, unknown>,
  message = "Pick a plan",
  required: string[] = [],
) {
  return {
    sessionId: "s1",
    mode: "form",
    message,
    requestedSchema: { type: "object", properties, required },
  };
}

function questions(plan: ReturnType<typeof planAcpElicitation>) {
  if (plan.kind !== "questions") {
    throw new Error(`expected questions, got ${JSON.stringify(plan)}`);
  }
  return plan;
}

describe("planAcpElicitation", () => {
  it("turns each field kind into a question and decodes the answers back to typed content", () => {
    const plan = questions(
      planAcpElicitation(
        form(
          {
            strategy: {
              type: "string",
              title: "Strategy",
              description: "How far to go",
              enum: ["conservative", "balanced", "aggressive"],
            },
            targets: {
              type: "array",
              items: {
                anyOf: [
                  { const: "web", title: "Web app" },
                  { const: "cli", title: "CLI" },
                ],
              },
            },
            dryRun: { type: "boolean" },
            retries: { type: "integer", title: "Retries" },
          },
          "Pick a plan",
          ["strategy", "targets", "dryRun", "retries"],
        ),
      ),
    );

    expect(plan.payload.questions).toEqual([
      {
        id: "strategy",
        prompt: "Pick a plan\n\nStrategy\nHow far to go",
        shortLabel: "Strategy",
        multiSelect: false,
        options: [
          { value: "conservative", label: "conservative" },
          { value: "balanced", label: "balanced" },
          { value: "aggressive", label: "aggressive" },
        ],
        allowFreeText: false,
        required: true,
      },
      {
        id: "targets",
        prompt: "targets",
        shortLabel: "targets",
        multiSelect: true,
        options: [
          { value: "web", label: "Web app" },
          { value: "cli", label: "CLI" },
        ],
        allowFreeText: false,
        required: true,
      },
      {
        id: "dryRun",
        prompt: "dryRun",
        shortLabel: "dryRun",
        multiSelect: false,
        options: [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ],
        allowFreeText: false,
        required: true,
      },
      {
        id: "retries",
        prompt: "Retries\nEnter a whole number.",
        shortLabel: "Retries",
        multiSelect: false,
        allowFreeText: true,
        required: true,
      },
    ]);

    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: {
          strategy: { selected: ["balanced"] },
          targets: { selected: ["web", "cli"] },
          dryRun: { selected: ["false"] },
          retries: { selected: [], freeText: " 3 " },
        },
      }),
    ).toEqual({
      action: "accept",
      content: {
        strategy: "balanced",
        targets: ["web", "cli"],
        dryRun: false,
        retries: 3,
      },
    });
  });

  it("declines when an answer does not fit its field", () => {
    const plan = questions(
      planAcpElicitation(
        form({ retries: { type: "integer" } }, "Pick a plan", ["retries"]),
      ),
    );
    for (const freeText of ["many", "2.5"]) {
      expect(
        plan.toResponse({
          kind: "user_answer",
          answers: { retries: { selected: [], freeText } },
        }),
      ).toEqual({ action: "decline" });
    }
    expect(plan.toResponse({ kind: "user_answer", answers: {} })).toEqual({
      action: "decline",
    });
  });

  it("asks for a typed answer when a choice has more options than the card can list, and matches it by value or label", () => {
    const plan = questions(
      planAcpElicitation(
        form({
          branch: {
            type: "string",
            oneOf: ["main", "dev", "release", "hotfix", "next"].map(
              (value) => ({ const: value, title: value.toUpperCase() }),
            ),
          },
        }),
      ),
    );
    expect(plan.payload.questions[0]).toMatchObject({
      allowFreeText: true,
      prompt: "Pick a plan\n\nbranch\nOne of: MAIN, DEV, RELEASE, HOTFIX, NEXT",
    });
    expect(plan.payload.questions[0]?.options).toBeUndefined();
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { branch: { selected: [], freeText: "Hotfix" } },
      }),
    ).toEqual({ action: "accept", content: { branch: "hotfix" } });
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { branch: { selected: [], freeText: "staging" } },
      }),
    ).toEqual({ action: "decline" });
  });

  it("shows a form without fields as accept or decline", () => {
    const plan = questions(planAcpElicitation(form({}, "Deploy now?")));
    expect(plan.payload.questions).toMatchObject([
      {
        prompt: "Deploy now?",
        options: [{ label: "Accept" }, { label: "Decline" }],
      },
    ]);
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { confirm: { selected: ["accept"] } },
      }),
    ).toEqual({ action: "accept", content: {} });
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { confirm: { selected: ["decline"] } },
      }),
    ).toEqual({ action: "decline" });
  });

  it("folds an omp choice and its __other text field into one question with free text (#6031)", () => {
    const plan = questions(
      planAcpElicitation({
        sessionId: "s1",
        mode: "form",
        message: "Answer 1 question",
        requestedSchema: {
          type: "object",
          properties: {
            q0: {
              type: "string",
              title: "Which branch?",
              oneOf: [
                { const: "alpha", title: "alpha" },
                { const: "beta", title: "beta" },
              ],
              default: "alpha",
            },
            q0__other: { type: "string", title: "Other (type your own)" },
          },
        },
      }),
    );
    expect(plan.payload.questions).toEqual([
      {
        id: "q0",
        prompt: "Answer 1 question\n\nWhich branch?",
        shortLabel: "Which branch?",
        multiSelect: false,
        options: [
          { value: "alpha", label: "alpha" },
          { value: "beta", label: "beta" },
        ],
        allowFreeText: true,
        required: false,
      },
    ]);
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { q0: { selected: [], freeText: " gamma " } },
      }),
    ).toEqual({ action: "accept", content: { q0__other: "gamma" } });
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { q0: { selected: ["beta"] } },
      }),
    ).toEqual({ action: "accept", content: { q0: "beta" } });
    expect(plan.toResponse({ kind: "user_answer", answers: {} })).toEqual({
      action: "accept",
      content: {},
    });
  });

  it("folds an omp multi-select and its __other text field, returning both picks and typed text", () => {
    const plan = questions(
      planAcpElicitation(
        form({
          q0: {
            type: "array",
            title: "Which targets?",
            items: {
              anyOf: [
                { const: "web", title: "Web" },
                { const: "cli", title: "CLI" },
              ],
            },
          },
          q0__other: { type: "string", title: "Other (type your own)" },
        }),
      ),
    );
    expect(plan.payload.questions).toMatchObject([
      { id: "q0", multiSelect: true, allowFreeText: true, required: false },
    ]);
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { q0: { selected: ["web"], freeText: "desktop" } },
      }),
    ).toEqual({
      action: "accept",
      content: { q0: ["web"], q0__other: "desktop" },
    });
  });

  it("folds a Droid choice and its optional _other field, keeping the main field required (#6131)", () => {
    const droidQuestion = (index: number) => ({
      [`question_${index}`]: {
        type: "string",
        title: `Topic ${index}`,
        description: `Which color ${index}?`,
        oneOf: [
          { const: "option_0", title: "Red" },
          { const: "option_1", title: "Blue" },
          { const: "other", title: "Other answer" },
        ],
      },
      [`question_${index}_other`]: {
        type: "string",
        title: `Topic ${index}: Other answer`,
        description: "Enter your answer here if you select Other answer.",
      },
    });
    const plan = questions(
      planAcpElicitation({
        sessionId: "s1",
        mode: "form",
        message: "Droid needs your answers to continue.",
        requestedSchema: {
          type: "object",
          required: ["question_1"],
          properties: droidQuestion(1),
        },
      }),
    );
    expect(plan.payload.questions).toEqual([
      {
        id: "question_1",
        prompt:
          "Droid needs your answers to continue.\n\nTopic 1\nWhich color 1?",
        shortLabel: "Topic 1",
        multiSelect: false,
        options: [
          { value: "option_0", label: "Red" },
          { value: "option_1", label: "Blue" },
        ],
        allowFreeText: true,
        required: true,
      },
    ]);
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { question_1: { selected: ["option_1"] } },
      }),
    ).toEqual({ action: "accept", content: { question_1: "option_1" } });
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { question_1: { selected: [], freeText: "Green" } },
      }),
    ).toEqual({
      action: "accept",
      content: { question_1: "other", question_1_other: "Green" },
    });
    expect(plan.toResponse({ kind: "user_answer", answers: {} })).toEqual({
      action: "decline",
    });

    const fourQuestions = questions(
      planAcpElicitation({
        sessionId: "s1",
        mode: "form",
        message: "Droid needs your answers to continue.",
        requestedSchema: {
          type: "object",
          required: ["question_1", "question_2", "question_3", "question_4"],
          properties: {
            ...droidQuestion(1),
            ...droidQuestion(2),
            ...droidQuestion(3),
            ...droidQuestion(4),
          },
        },
      }),
    );
    expect(
      fourQuestions.payload.questions.map((question) => question.id),
    ).toEqual(["question_1", "question_2", "question_3", "question_4"]);
  });

  it("lets optional fields be left blank and leaves them out of the content (#6131)", () => {
    const plan = questions(
      planAcpElicitation({
        sessionId: "s1",
        mode: "form",
        message: "Pick a plan",
        requestedSchema: {
          type: "object",
          required: ["strategy"],
          properties: {
            strategy: { type: "string", enum: ["fast", "safe"] },
            notes: { type: "string", title: "Notes" },
            retries: { type: "integer" },
          },
        },
      }),
    );
    expect(
      plan.payload.questions.map((question) => [
        question.id,
        question.required,
      ]),
    ).toEqual([
      ["strategy", true],
      ["notes", false],
      ["retries", false],
    ]);
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { strategy: { selected: ["safe"] }, notes: { selected: [] } },
      }),
    ).toEqual({ action: "accept", content: { strategy: "safe" } });
    expect(
      plan.toResponse({
        kind: "user_answer",
        answers: { notes: { selected: [], freeText: "hi" } },
      }),
    ).toEqual({ action: "decline" });
  });

  it("counts questions after folding against the limit and names both counts (#6266)", () => {
    const omp = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          [
            `q${index}`,
            {
              type: "string",
              title: `Question ${index}`,
              oneOf: [
                { const: "a", title: "A" },
                { const: "b", title: "B" },
              ],
            },
          ],
          [`q${index}__other`, { type: "string", title: "Other" }],
        ]).flat(),
      );
    expect(
      questions(planAcpElicitation(form(omp(4)))).payload.questions,
    ).toHaveLength(4);
    expect(planAcpElicitation(form(omp(6)))).toEqual({
      kind: "unsupported",
      reason: "bb shows at most 4 questions; this form has 6",
    });
  });

  it("refuses forms it cannot show, with the reason", () => {
    expect(
      planAcpElicitation({ mode: "url", url: "https://example.com" }),
    ).toEqual({
      kind: "unsupported",
      reason: 'bb does not offer the "url" elicitation mode',
    });
    expect(
      planAcpElicitation(
        form(
          Object.fromEntries(
            ["a", "b", "c", "d", "e"].map((name) => [name, { type: "string" }]),
          ),
        ),
      ),
    ).toEqual({
      kind: "unsupported",
      reason: "bb shows at most 4 questions; this form has 5",
    });
    expect(planAcpElicitation(form({ nested: { type: "object" } }))).toEqual({
      kind: "unsupported",
      reason: 'bb cannot show the field "nested"',
    });
  });
});

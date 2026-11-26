import { describe, expect, it } from "vitest";
import type {
  AcpElicitationResponse,
  AcpElicitationUnmappable,
} from "./elicitation.js";
import {
  buildGrokQuestionPlan,
  decodeGrokQuestionRequest,
  grokQuestionResponse,
  type GrokQuestionRequest,
} from "./grok-questions.js";

function requestWith(
  questions: readonly Record<string, unknown>[],
): GrokQuestionRequest {
  return decodeGrokQuestionRequest({
    sessionId: "grok-session",
    toolCallId: "grok-tool-call",
    questions,
    mode: "default",
  });
}

function mappableResponse(
  response: AcpElicitationResponse | AcpElicitationUnmappable,
): AcpElicitationResponse {
  if ("unmappable" in response) {
    throw new Error(response.unmappable);
  }
  return response;
}

function singleRequest(): GrokQuestionRequest {
  return requestWith([
    {
      question: "Choose synthetic option",
      options: [
        {
          label: "Alpha",
          description: "First synthetic choice",
          preview: "PREVIEW_ALPHA",
        },
        {
          label: "Beta",
          description: "Second synthetic choice",
          preview: "PREVIEW_BETA",
        },
      ],
      multiSelect: false,
    },
  ]);
}

describe("Grok question adapter", () => {
  it("single_select_preserves_question_and_option_values", () => {
    const request = singleRequest();
    const plan = buildGrokQuestionPlan(request);
    expect(plan.kind).toBe("questions");
    if (plan.kind !== "questions") return;

    expect(plan.payload).toEqual({
      kind: "user_question",
      questions: [
        {
          id: "question-1",
          prompt: "Choose synthetic option",
          shortLabel: "Question 1",
          multiSelect: false,
          options: [
            {
              value: "Alpha",
              label: "Alpha",
              description: "First synthetic choice",
              preview: "PREVIEW_ALPHA",
            },
            {
              value: "Beta",
              label: "Beta",
              description: "Second synthetic choice",
              preview: "PREVIEW_BETA",
            },
          ],
          allowFreeText: false,
          required: true,
        },
      ],
    });

    const resolution = {
      kind: "user_answer" as const,
      answers: { "question-1": { selected: ["Alpha"] } },
    };
    const response = mappableResponse(plan.toResponse(resolution));
    expect(grokQuestionResponse(request, response)).toEqual({
      outcome: "accepted",
      answers: { "Choose synthetic option": "Alpha" },
      annotations: {
        "Choose synthetic option": { preview: "PREVIEW_ALPHA" },
      },
    });
  });

  it("multi_select_preserves_every_selected_value", () => {
    const request = requestWith([
      {
        question: "Choose extras",
        options: [
          { label: "Logo", preview: "LOGO_PREVIEW" },
          { label: "Tagline", preview: "TAGLINE_PREVIEW" },
          { label: "Icon" },
        ],
        multiSelect: true,
      },
    ]);
    const plan = buildGrokQuestionPlan(request);
    expect(plan.kind).toBe("questions");
    if (plan.kind !== "questions") return;
    expect(plan.payload.questions[0]?.multiSelect).toBe(true);

    const response = mappableResponse(
      plan.toResponse({
        kind: "user_answer",
        answers: { "question-1": { selected: ["Logo", "Icon"] } },
      }),
    );
    expect(grokQuestionResponse(request, response)).toEqual({
      outcome: "accepted",
      answers: { "Choose extras": ["Logo", "Icon"] },
      annotations: { "Choose extras": { preview: "LOGO_PREVIEW" } },
    });
  });

  it("other_free_text_round_trips_with_unicode", () => {
    const request = requestWith([
      {
        question: "Выберите стек 😀",
        options: [
          { label: "TypeScript", description: "詳細な選択肢" },
          { label: "Other (please specify)", preview: "OTHER_PREVIEW" },
        ],
        multiSelect: false,
      },
    ]);
    const plan = buildGrokQuestionPlan(request);
    expect(plan.kind).toBe("questions");
    if (plan.kind !== "questions") return;
    expect(plan.payload.questions[0]?.allowFreeText).toBe(true);

    const response = mappableResponse(
      plan.toResponse({
        kind: "user_answer",
        answers: {
          "question-1": {
            selected: [],
            freeText: "Rust и مراجعة 😀",
          },
        },
      }),
    );
    expect(grokQuestionResponse(request, response)).toEqual({
      outcome: "accepted",
      answers: { "Выберите стек 😀": "Other (please specify)" },
      annotations: {
        "Выберите стек 😀": {
          notes: "Rust и مراجعة 😀",
          preview: "OTHER_PREVIEW",
        },
      },
    });
  });

  it("keeps an explicit choice and appends Other for multi-select free text", () => {
    const single = requestWith([
      {
        question: "Choose one",
        options: [{ label: "TypeScript" }, { label: "Other..." }],
        multiSelect: false,
      },
    ]);
    const singlePlan = buildGrokQuestionPlan(single);
    if (singlePlan.kind !== "questions") return;
    expect(
      grokQuestionResponse(
        single,
        mappableResponse(
          singlePlan.toResponse({
            kind: "user_answer",
            answers: {
              "question-1": {
                selected: ["TypeScript"],
                freeText: "also Rust",
              },
            },
          }),
        ),
      ),
    ).toEqual({
      outcome: "accepted",
      answers: { "Choose one": "TypeScript" },
      annotations: { "Choose one": { notes: "also Rust" } },
    });

    const multi = requestWith([
      {
        question: "Choose extras",
        options: [{ label: "Logo" }, { label: "Other (please specify)" }],
        multiSelect: true,
      },
    ]);
    const multiPlan = buildGrokQuestionPlan(multi);
    if (multiPlan.kind !== "questions") return;
    expect(
      grokQuestionResponse(
        multi,
        mappableResponse(
          multiPlan.toResponse({
            kind: "user_answer",
            answers: {
              "question-1": { selected: ["Logo"], freeText: "a custom mark" },
            },
          }),
        ),
      ),
    ).toEqual({
      outcome: "accepted",
      answers: { "Choose extras": ["Logo", "Other (please specify)"] },
      annotations: { "Choose extras": { notes: "a custom mark" } },
    });
  });

  it("empty_options_are_rejected", () => {
    expect(() =>
      requestWith([
        { question: "No choices", options: [], multiSelect: false },
      ]),
    ).toThrow(/options/i);
  });

  it("duplicate_options_are_rejected", () => {
    expect(() =>
      requestWith([
        {
          question: "Duplicate",
          options: [{ label: "Same" }, { label: "Same" }],
          multiSelect: false,
        },
      ]),
    ).toThrow(/unique|duplicate/i);
  });

  it("too_many_questions_are_rejected", () => {
    expect(() =>
      requestWith(
        Array.from({ length: 11 }, (_, index) => ({
          question: `Question ${index + 1}`,
          options: [{ label: "Alpha" }],
          multiSelect: false,
        })),
      ),
    ).toThrow(/10|questions/i);
  });

  it("too_many_options_are_rejected", () => {
    expect(() =>
      requestWith([
        {
          question: "Too many",
          options: Array.from({ length: 5 }, (_, index) => ({
            label: `Option ${index + 1}`,
          })),
          multiSelect: false,
        },
      ]),
    ).toThrow(/4|options/i);
  });

  it.each([
    ["non-string", { preview: 42 }],
    ["empty", { preview: "  " }],
    ["oversized", { preview: "x".repeat(16_001) }],
  ])("malformed_preview_is_rejected_%s", (_name, option) => {
    expect(() =>
      requestWith([
        {
          question: "Preview",
          options: [{ label: "Alpha", ...option }],
          multiSelect: false,
        },
      ]),
    ).toThrow(/preview/i);
  });

  it("cancel_decline_and_accept_have_distinct_protocol_results", () => {
    const request = singleRequest();
    const accepted: AcpElicitationResponse = {
      action: "accept",
      content: { "question-1": { selected: ["Beta"] } },
    };
    expect(grokQuestionResponse(request, accepted).outcome).toBe("accepted");
    expect(grokQuestionResponse(request, { action: "decline" })).toEqual({
      outcome: "chat_about_this",
    });
    expect(grokQuestionResponse(request, { action: "cancel" })).toEqual({
      outcome: "skip_interview",
    });
  });

  it("rejects_an_empty_question_list", () => {
    expect(() => requestWith([])).toThrow(/questions/i);
  });
});

import { describe, expect, it } from "vitest";
import {
  answerStateFor,
  areAllQuestionsAnswered,
  buildAskUserQuestionResponse,
  buildUserAnswerResolution,
  createInitialFormState,
  isQuestionAnswered,
  normalizeAskUserQuestion,
  normalizeUserQuestion,
  setQuestionFreeText,
  toggleQuestionOption,
  toggleQuestionOther,
  type InteractionFormQuestion,
} from "./question-form-state";

const single: InteractionFormQuestion = {
  id: "q1",
  prompt: "Which color?",
  shortLabel: "Color",
  multiSelect: false,
  options: [
    { value: "red", label: "Red" },
    { value: "blue", label: "Blue" },
  ],
  allowFreeText: true,
};

const multi: InteractionFormQuestion = {
  ...single,
  id: "q2",
  multiSelect: true,
};

const freeOnly: InteractionFormQuestion = {
  id: "q3",
  prompt: "Anything else?",
  shortLabel: "Notes",
  multiSelect: false,
  options: [],
  allowFreeText: true,
};

describe("question form state", () => {
  it("starts free-text-only questions with Other implicitly selected", () => {
    const state = createInitialFormState([single, freeOnly]);
    expect(state.q1?.otherSelected).toBe(false);
    expect(state.q3?.otherSelected).toBe(true);
    expect(isQuestionAnswered(freeOnly, answerStateFor(state, freeOnly))).toBe(
      false,
    );
  });

  it("single-select: an option replaces Other and vice versa", () => {
    let state = answerStateFor(createInitialFormState([single]), single);
    state = toggleQuestionOther(single, state);
    state = setQuestionFreeText(state, "custom");
    expect(isQuestionAnswered(single, state)).toBe(true);
    state = toggleQuestionOption(single, state, "red");
    expect(state.selected).toEqual(["red"]);
    expect(state.otherSelected).toBe(false);
    // Typed text is retained but not sent once Other is deselected.
    const resolution = buildUserAnswerResolution([single], { q1: state });
    expect(resolution).toEqual({
      kind: "user_answer",
      answers: { q1: { selected: ["red"] } },
    });
    state = toggleQuestionOther(single, state);
    expect(state.selected).toEqual([]);
    expect(
      buildUserAnswerResolution([single], { q1: state }).answers.q1,
    ).toEqual({ selected: [], freeText: "custom" });
  });

  it("multi-select: options toggle and coexist with free text", () => {
    let state = answerStateFor(createInitialFormState([multi]), multi);
    state = toggleQuestionOption(multi, state, "red");
    state = toggleQuestionOption(multi, state, "blue");
    state = toggleQuestionOption(multi, state, "red");
    state = toggleQuestionOther(multi, state);
    state = setQuestionFreeText(state, "  also green  ");
    expect(buildAskUserQuestionResponse([multi], { q2: state })).toEqual({
      answers: { q2: { selected: ["blue"], freeText: "also green" } },
    });
    // Blank free text with Other selected is not an answer.
    state = setQuestionFreeText(state, "   ");
    state = toggleQuestionOption(multi, state, "blue");
    expect(isQuestionAnswered(multi, state)).toBe(false);
  });

  it("drops selections that no longer match an option", () => {
    const state = {
      selected: ["green", "red"],
      otherSelected: false,
      otherText: "",
    };
    expect(
      buildUserAnswerResolution([single], { q1: state }).answers.q1,
    ).toEqual({ selected: ["red"] });
  });

  it("requires every question to be answered", () => {
    const state = createInitialFormState([single, freeOnly]);
    expect(areAllQuestionsAnswered([single, freeOnly], state)).toBe(false);
    const next = {
      ...state,
      q1: toggleQuestionOption(single, answerStateFor(state, single), "blue"),
      q3: setQuestionFreeText(answerStateFor(state, freeOnly), "notes"),
    };
    expect(areAllQuestionsAnswered([single, freeOnly], next)).toBe(true);
    expect(areAllQuestionsAnswered([], {})).toBe(false);
  });

  it("normalizes provider and plugin question shapes", () => {
    expect(
      normalizeUserQuestion(
        {
          id: "n1",
          prompt: "Pick",
          multiSelect: false,
          allowFreeText: true,
        },
        2,
      ),
    ).toEqual({
      id: "n1",
      prompt: "Pick",
      shortLabel: "Question 3",
      multiSelect: false,
      options: [],
      allowFreeText: true,
    });
    expect(
      normalizeAskUserQuestion({
        id: "p1",
        prompt: "Pick",
        shortLabel: "Pick",
        multiSelect: true,
        allowFreeText: false,
        options: [
          { value: "a", label: "A", description: "desc", preview: "pre" },
        ],
      }).options,
    ).toEqual([
      { value: "a", label: "A", description: "desc", preview: "pre" },
    ]);
  });
});

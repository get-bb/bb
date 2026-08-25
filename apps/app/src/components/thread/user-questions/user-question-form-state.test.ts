import { describe, expect, it } from "vitest";
import type { PendingInteractionUserQuestionQuestion } from "@bb/domain";
import {
  buildUserAnswerResolution,
  createInitialFormState,
  isQuestionAnswered,
} from "./user-question-form-state.js";

const singleSelect: PendingInteractionUserQuestionQuestion = {
  id: "branch",
  prompt: "Which branch?",
  multiSelect: false,
  allowFreeText: true,
  options: [
    { value: "main", label: "main" },
    { value: "release", label: "release" },
  ],
};

const multiSelect: PendingInteractionUserQuestionQuestion = {
  id: "areas",
  prompt: "Which areas?",
  multiSelect: true,
  allowFreeText: true,
  options: [
    { value: "app", label: "App" },
    { value: "cli", label: "CLI" },
  ],
};

const freeTextOnly: PendingInteractionUserQuestionQuestion = {
  id: "notes",
  prompt: "Anything else?",
  multiSelect: false,
  allowFreeText: true,
};

const verbatimText: PendingInteractionUserQuestionQuestion = {
  id: "exact",
  prompt: "Exact value",
  multiSelect: false,
  allowFreeText: true,
  experimental_responseMode: "verbatim",
  experimental_prefill: "  initial\nvalue  ",
};

describe("buildUserAnswerResolution", () => {
  it("returns the selected option for a single-select choice", () => {
    const state = createInitialFormState([singleSelect]);
    state.branch.selected = ["main"];

    expect(buildUserAnswerResolution([singleSelect], state)).toEqual({
      kind: "user_answer",
      answers: { branch: { selected: ["main"] } },
    });
  });

  it("treats Other as free text that replaces the selection (single-select)", () => {
    const state = createInitialFormState([singleSelect]);
    state.branch.otherSelected = true;
    state.branch.otherText = "  a custom branch  ";

    expect(
      buildUserAnswerResolution([singleSelect], state).answers.branch,
    ).toEqual({ selected: [], freeText: "a custom branch" });
  });

  it("omits free text when Other is selected but blank", () => {
    const state = createInitialFormState([singleSelect]);
    state.branch.otherSelected = true;
    state.branch.otherText = "   ";

    expect(
      buildUserAnswerResolution([singleSelect], state).answers.branch,
    ).toEqual({ selected: [] });
  });

  it("keeps both options and free text for multi-select", () => {
    const state = createInitialFormState([multiSelect]);
    state.areas.selected = ["app", "cli"];
    state.areas.otherSelected = true;
    state.areas.otherText = "docs";

    expect(
      buildUserAnswerResolution([multiSelect], state).answers.areas,
    ).toEqual({ selected: ["app", "cli"], freeText: "docs" });
  });

  it("drops option values that aren't part of the question", () => {
    const state = createInitialFormState([singleSelect]);
    state.branch.selected = ["main", "ghost"];

    expect(
      buildUserAnswerResolution([singleSelect], state).answers.branch,
    ).toEqual({ selected: ["main"] });
  });

  it("captures free text for an options-less question", () => {
    const state = createInitialFormState([freeTextOnly]);
    // No options → "Other" is implicitly active so the textarea is the answer.
    expect(state.notes.otherSelected).toBe(true);
    state.notes.otherText = "ship it";

    expect(
      buildUserAnswerResolution([freeTextOnly], state).answers.notes,
    ).toEqual({ selected: [], freeText: "ship it" });
  });

  it("preserves editor prefill and its submitted replacement byte-for-byte", () => {
    const state = createInitialFormState([verbatimText]);
    expect(state.exact.otherText).toBe("  initial\nvalue  ");
    state.exact.otherText = "  exact\nvalue  ";

    expect(
      buildUserAnswerResolution([verbatimText], state).answers.exact,
    ).toEqual({ selected: [], experimental_verbatimText: "  exact\nvalue  " });
  });
});

describe("isQuestionAnswered", () => {
  it("is answered when an option is selected", () => {
    expect(
      isQuestionAnswered(singleSelect, {
        selected: ["main"],
        otherSelected: false,
        otherText: "",
      }),
    ).toBe(true);
  });

  it("is answered when Other has non-empty text", () => {
    expect(
      isQuestionAnswered(singleSelect, {
        selected: [],
        otherSelected: true,
        otherText: "x",
      }),
    ).toBe(true);
  });

  it("accepts an empty string for a verbatim input", () => {
    expect(
      isQuestionAnswered(verbatimText, {
        selected: [],
        otherSelected: true,
        otherText: "",
      }),
    ).toBe(true);
  });

  it("is not answered when Other is selected but blank", () => {
    expect(
      isQuestionAnswered(singleSelect, {
        selected: [],
        otherSelected: true,
        otherText: "   ",
      }),
    ).toBe(false);
  });

  it("is not answered with no selection and no text", () => {
    expect(
      isQuestionAnswered(singleSelect, {
        selected: [],
        otherSelected: false,
        otherText: "",
      }),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { Question } from "@bb/shared-ui/question-form-state";
import {
  buildQuestionAnswers,
  createInitialFormState,
  isQuestionAnswered,
} from "@bb/shared-ui/question-form-state";

const singleSelect: Question = {
  id: "branch",
  prompt: "Which branch?",
  shortLabel: "Branch",
  multiSelect: false,
  allowFreeText: true,
  options: [
    { value: "main", label: "main" },
    { value: "release", label: "release" },
  ],
};

const multiSelect: Question = {
  id: "areas",
  prompt: "Which areas?",
  shortLabel: "Areas",
  multiSelect: true,
  allowFreeText: true,
  options: [
    { value: "app", label: "App" },
    { value: "cli", label: "CLI" },
  ],
};

const freeTextOnly: Question = {
  id: "notes",
  prompt: "Anything else?",
  shortLabel: "Notes",
  options: [],
  multiSelect: false,
  allowFreeText: true,
};

describe("buildQuestionAnswers", () => {
  it("returns the selected option for a single-select choice", () => {
    const state = createInitialFormState([singleSelect]);
    state.branch.selected = ["main"];

    expect(buildQuestionAnswers([singleSelect], state)).toEqual({
      branch: { selected: ["main"] },
    });
  });

  it("treats Other as free text that replaces the selection (single-select)", () => {
    const state = createInitialFormState([singleSelect]);
    state.branch.otherSelected = true;
    state.branch.otherText = "  a custom branch  ";

    expect(buildQuestionAnswers([singleSelect], state).branch).toEqual({
      selected: [],
      freeText: "a custom branch",
    });
  });

  it("omits free text when Other is selected but blank", () => {
    const state = createInitialFormState([singleSelect]);
    state.branch.otherSelected = true;
    state.branch.otherText = "   ";

    expect(buildQuestionAnswers([singleSelect], state).branch).toEqual({
      selected: [],
    });
  });

  it("keeps both options and free text for multi-select", () => {
    const state = createInitialFormState([multiSelect]);
    state.areas.selected = ["app", "cli"];
    state.areas.otherSelected = true;
    state.areas.otherText = "docs";

    expect(buildQuestionAnswers([multiSelect], state).areas).toEqual({
      selected: ["app", "cli"],
      freeText: "docs",
    });
  });

  it("drops option values that aren't part of the question", () => {
    const state = createInitialFormState([singleSelect]);
    state.branch.selected = ["main", "ghost"];

    expect(buildQuestionAnswers([singleSelect], state).branch).toEqual({
      selected: ["main"],
    });
  });

  it("captures free text for an options-less question", () => {
    const state = createInitialFormState([freeTextOnly]);
    expect(state.notes.otherSelected).toBe(true);
    state.notes.otherText = "ship it";

    expect(buildQuestionAnswers([freeTextOnly], state).notes).toEqual({
      selected: [],
      freeText: "ship it",
    });
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

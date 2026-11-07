import {
  experimental_useQuestionFormHost,
  type ExperimentalQuestionFormAction,
  type ExperimentalQuestionFormHost,
  type ExperimentalQuestionShortcut,
} from "@get-bb/plugin-sdk/app";

export type QuestionFormHost = ExperimentalQuestionFormHost & {
  density: "default" | "compact";
  promptShownAbove: string | null;
  closeInline: (() => void) | null;
};
export type QuestionShortcut = ExperimentalQuestionShortcut;
export type QuestionFormAction = ExperimentalQuestionFormAction;
export function useQuestionFormHost(): QuestionFormHost {
  return {
    ...experimental_useQuestionFormHost(),
    density: "default",
    promptShownAbove: null,
    closeInline: null,
  };
}

import {
  experimental_useQuestionFormHost,
  type ExperimentalQuestionFormAction,
  type ExperimentalQuestionFormHost,
  type ExperimentalQuestionShortcut,
} from "@get-bb/plugin-sdk/app";

export type QuestionFormHost = ExperimentalQuestionFormHost;
export type QuestionShortcut = ExperimentalQuestionShortcut;
export type QuestionFormAction = ExperimentalQuestionFormAction;
export const useQuestionFormHost: () => QuestionFormHost =
  experimental_useQuestionFormHost;

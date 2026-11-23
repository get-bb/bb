import { createContext, useContext } from "react";
import type { ExperimentalQuestionFormHost } from "@get-bb/plugin-sdk";

const QuestionFormHostContext = createContext<ExperimentalQuestionFormHost>({
  density: "default",
  promptShownAbove: null,
  closeInline: null,
  shortcuts: new Map(),
  actionShortcuts: new Map(),
  registerChoiceHandler: () => () => {},
  registerActionHandler: () => () => {},
});

export const QuestionFormHostProvider = QuestionFormHostContext.Provider;

export function useQuestionFormHost(): ExperimentalQuestionFormHost {
  return useContext(QuestionFormHostContext);
}

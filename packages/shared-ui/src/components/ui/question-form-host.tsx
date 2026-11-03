import { createContext, useContext } from "react";

export interface QuestionShortcut {
  label: string;
  ariaKeyshortcuts: string;
}

export type QuestionFormAction = "submit" | "previous" | "next" | "cancel";

export interface QuestionFormHost {
  density: "default" | "compact";
  promptShownAbove: string | null;
  closeInline: (() => void) | null;
  shortcuts: ReadonlyMap<string, QuestionShortcut>;
  actionShortcuts: ReadonlyMap<QuestionFormAction, QuestionShortcut>;
  registerChoiceHandler: (handler: (index: number) => boolean) => () => void;
  registerActionHandler: (
    handler: (action: QuestionFormAction) => boolean,
  ) => () => void;
}

const QuestionFormHostContext = createContext<QuestionFormHost>({
  density: "default",
  promptShownAbove: null,
  closeInline: null,
  shortcuts: new Map(),
  actionShortcuts: new Map(),
  registerChoiceHandler: () => () => {},
  registerActionHandler: () => () => {},
});

export const QuestionFormHostProvider = QuestionFormHostContext.Provider;
export function useQuestionFormHost(): QuestionFormHost {
  return useContext(QuestionFormHostContext);
}

import { createContext, useContext, type ComponentType } from "react";

export interface QuestionShortcut {
  label: string;
  ariaKeyshortcuts: string;
}

export interface QuestionFormHost {
  experimental_VoiceInput?: ComponentType<{
    disabled: boolean;
    onTranscript: (text: string) => void;
    onBusyChange: (busy: boolean) => void;
  }>;
  shortcuts: ReadonlyMap<string, QuestionShortcut>;
  registerChoiceHandler: (handler: (index: number) => boolean) => () => void;
}

const QuestionFormHostContext = createContext<QuestionFormHost>({
  shortcuts: new Map(),
  registerChoiceHandler: () => () => {},
});

export const QuestionFormHostProvider = QuestionFormHostContext.Provider;
export function useQuestionFormHost(): QuestionFormHost {
  return useContext(QuestionFormHostContext);
}

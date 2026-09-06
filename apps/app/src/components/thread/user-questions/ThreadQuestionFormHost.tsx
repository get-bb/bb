import { isEditableKeyboardTarget } from "@/lib/app-keybindings";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { QUESTION_SELECT_APP_COMMAND_IDS } from "@bb/domain";
import { QuestionFormHostProvider } from "@bb/shared-ui/question-form-host";
import {
  useAppCommandContext,
  useAppCommandShortcuts,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";

export function ThreadQuestionFormHost({ children }: { children: ReactNode }) {
  const handlerRef = useRef<((index: number) => boolean) | null>(null);
  const [hasHandler, setHasHandler] = useState(false);
  const isFocusedPane = useOptionalPaneContext()?.isFocused ?? true;
  const bindings = useAppCommandShortcuts(QUESTION_SELECT_APP_COMMAND_IDS);
  const registerChoiceHandler = useCallback(
    (handler: (index: number) => boolean) => {
      handlerRef.current = handler;
      setHasHandler(true);
      return () => {
        handlerRef.current = null;
        setHasHandler(false);
      };
    },
    [],
  );
  const value = useMemo(
    () => ({
      shortcuts: new Map(
        QUESTION_SELECT_APP_COMMAND_IDS.flatMap((command, index) => {
          const binding = bindings.get(command);
          return binding ? [[String(index), binding] as const] : [];
        }),
      ),
      registerChoiceHandler,
    }),
    [bindings, registerChoiceHandler],
  );
  const enabled = isFocusedPane && hasHandler;
  useAppCommandContext("questionOpen", enabled);
  useIndexedAppCommandHandlers(
    QUESTION_SELECT_APP_COMMAND_IDS,
    (index, invocation) => {
      if (isEditableKeyboardTarget(invocation.target)) return false;
      return enabled ? (handlerRef.current?.(index) ?? false) : false;
    },
    100,
    enabled,
  );
  return (
    <QuestionFormHostProvider value={value}>
      {children}
    </QuestionFormHostProvider>
  );
}

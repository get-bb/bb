import { VoiceInputTextarea } from "@/components/promptbox/VoiceInputTextarea";
import { isEditableKeyboardTarget } from "@/lib/app-keybindings";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  QUESTION_ACTION_APP_COMMAND_IDS,
  QUESTION_SELECT_APP_COMMAND_IDS,
} from "@bb/domain";
import {
  QuestionFormHostProvider,
  type QuestionFormAction,
  type QuestionFormHost,
} from "@bb/shared-ui/question-form-host";
import { VoiceInputTextareaProvider } from "@bb/shared-ui/voice-input-textarea";
import {
  useAppCommandContext,
  useAppCommandShortcuts,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";

const QUESTION_FORM_ACTIONS = [
  "submit",
  "previous",
  "next",
  "cancel",
] as const satisfies readonly QuestionFormAction[];

export function ThreadQuestionFormHost({
  children,
  density,
  promptShownAbove,
  closeInline,
}: {
  children: ReactNode;
  density: QuestionFormHost["density"];
  promptShownAbove: string | null;
  closeInline: (() => void) | null;
}) {
  const handlerRef = useRef<((index: number) => boolean) | null>(null);
  const actionHandlerRef = useRef<
    ((action: QuestionFormAction) => boolean) | null
  >(null);
  const [hasHandler, setHasHandler] = useState(false);
  const [hasActionHandler, setHasActionHandler] = useState(false);
  const isFocusedPane = useOptionalPaneContext()?.isFocused ?? true;
  const bindings = useAppCommandShortcuts(QUESTION_SELECT_APP_COMMAND_IDS);
  const actionBindings = useAppCommandShortcuts(
    QUESTION_ACTION_APP_COMMAND_IDS,
  );
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
  const registerActionHandler = useCallback(
    (handler: (action: QuestionFormAction) => boolean) => {
      actionHandlerRef.current = handler;
      setHasActionHandler(true);
      return () => {
        actionHandlerRef.current = null;
        setHasActionHandler(false);
      };
    },
    [],
  );
  const value = useMemo(
    () => ({
      density,
      promptShownAbove,
      closeInline,
      shortcuts: new Map(
        QUESTION_SELECT_APP_COMMAND_IDS.flatMap((command, index) => {
          const binding = bindings.get(command);
          return binding ? [[String(index), binding] as const] : [];
        }),
      ),
      actionShortcuts: new Map(
        QUESTION_ACTION_APP_COMMAND_IDS.flatMap((command, index) => {
          const binding = actionBindings.get(command);
          return binding
            ? [[QUESTION_FORM_ACTIONS[index], binding] as const]
            : [];
        }),
      ),
      registerChoiceHandler,
      registerActionHandler,
    }),
    [
      actionBindings,
      bindings,
      closeInline,
      density,
      promptShownAbove,
      registerActionHandler,
      registerChoiceHandler,
    ],
  );
  const enabled = isFocusedPane && (hasHandler || hasActionHandler);
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
  useIndexedAppCommandHandlers(
    QUESTION_ACTION_APP_COMMAND_IDS,
    (index) => {
      const action = QUESTION_FORM_ACTIONS[index];
      if (!enabled || action === undefined) return false;
      return actionHandlerRef.current?.(action) ?? false;
    },
    100,
    enabled,
  );
  return (
    <QuestionFormHostProvider value={value}>
      <VoiceInputTextareaProvider value={VoiceInputTextarea}>
        {children}
      </VoiceInputTextareaProvider>
    </QuestionFormHostProvider>
  );
}

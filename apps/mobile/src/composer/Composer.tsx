import type {
  PromptDraftAttachment,
  PromptMentionSuggestion,
  ProviderCommandSuggestion,
} from "@bb/client-core";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pressable, View } from "react-native";
import { haptic } from "@/lib/haptics";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { buildProjectAttachmentContentUrl } from "@/data/thread-detail";
import { useSystemConfig, useSystemProviders } from "@/data/system";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Button,
  Icon,
  Spinner,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import { AttachmentChips } from "./AttachmentChips";
import { ComposerInput, type ComposerInputHandle } from "./ComposerInput";
import {
  ExecutionControls,
  type ExecutionControlsProps,
} from "./ExecutionControls";
import {
  buildComposerPromptActions,
  commandInsertionFromSuggestion,
  hasComposerText,
  hasWhitespaceAt,
  insertMention,
  insertText,
  mentionInsertionFromSuggestion,
  PROMPT_ACTION_PRESENTATION,
  resolvePromptActionInsertion,
  resolveSubmitAffordance,
  type ComposerAction,
  type ComposerPromptAction,
  type ComposerSubmitKind,
  type ComposerSubmitMode,
  type ComposerValue,
  type TextSelection,
} from "./model";
import { TypeaheadMenu } from "./TypeaheadMenu";
import { useComposerAttachments } from "./useComposerAttachments";
import {
  useComposerTypeahead,
  type ComposerScope,
} from "./useComposerTypeahead";
import { useComposerVoice } from "./useComposerVoice";
import { VoiceBar } from "./VoiceBar";

export interface ComposerHandle {
  focus: () => void;
  blur: () => void;
  /** Insert text at the caret with smart spacing (voice, quotes, "+" actions). */
  insertText: (text: string) => void;
}

export interface ComposerProps {
  value: ComposerValue;
  onChange: (value: ComposerValue) => void;
  attachments: readonly PromptDraftAttachment[];
  onAttachmentsChange: (next: PromptDraftAttachment[]) => void;
  scope: ComposerScope;
  submitMode: ComposerSubmitMode;
  /** `send` (ready), `queue` (runtime active), `steer` (long-press while active). */
  onSubmit: (kind: ComposerSubmitKind) => void | Promise<void>;
  /** Label for the ready-state submit button ("Send", "Create"). */
  submitLabel?: string;
  isSubmitting?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Extra rows for the "+" menu (screen-owned: fork, new thread here, …). */
  actions?: readonly ComposerAction[];
  /** Execution pills in the footer; omit to leave the footer to the buttons. */
  executionControls?: ExecutionControlsProps | null;
  /** Rendered inside the card above the attachments (context banners). */
  header?: ReactNode;
  /** Small trailing element in the footer (context-window readout). */
  footerAccessory?: ReactNode;
  /**
   * Where the suggestion list opens. `above` floats over whatever sits above
   * the card (thread screen, composer at the bottom); `below` renders inline
   * under the input (compose screen, composer near the top of a scroll view).
   */
  typeaheadPlacement?: "above" | "below";
  autoFocus?: boolean;
  minInputHeight?: number;
  testID?: string;
}

const EMPTY_ACTIONS: readonly ComposerAction[] = [];

/**
 * The shared native composer (root compose + follow-up): mention pills in a
 * native `TextInput`, `@` / `#` / `/` typeahead, attachments (library,
 * camera, files → `POST /projects/:id/attachments`), voice (expo-audio →
 * `POST /system/voice-transcription`), the "+" actions menu, execution
 * pills, and a submit button driven by the client-core submit mode.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      value,
      onChange,
      attachments,
      onAttachmentsChange,
      scope,
      submitMode,
      onSubmit,
      submitLabel = "Send",
      isSubmitting = false,
      disabled = false,
      placeholder,
      actions = EMPTY_ACTIONS,
      executionControls,
      header,
      footerAccessory,
      typeaheadPlacement = "above",
      autoFocus = false,
      minInputHeight,
      testID = "composer",
    },
    ref,
  ) {
    const { tokens } = useTheme();
    const { serverUrl } = useProfileClient();
    const inputRef = useRef<ComposerInputHandle>(null);
    const valueRef = useRef(value);
    useEffect(() => {
      valueRef.current = value;
    }, [value]);
    const [selection, setSelection] = useState<TextSelection>({
      start: 0,
      end: 0,
    });
    const [focused, setFocused] = useState(false);
    const systemConfig = useSystemConfig();
    const providers = useSystemProviders();
    const provider = useMemo(
      () =>
        providers.data?.find((entry) => entry.id === scope.providerId) ?? null,
      [providers.data, scope.providerId],
    );
    const promptActionModel = useMemo(
      () => buildComposerPromptActions(provider?.composerActions ?? []),
      [provider],
    );

    const commit = useCallback(
      (next: ComposerValue, caret?: number) => {
        valueRef.current = next;
        onChange(next);
        if (caret !== undefined) setSelection({ start: caret, end: caret });
      },
      [onChange],
    );

    const typeahead = useComposerTypeahead({
      scope,
      value,
      selection,
      active: focused && !disabled,
      skillsTrigger: promptActionModel.skillsTrigger,
      promptActions: promptActionModel.actions,
    });
    const activeTrigger = typeahead.activeTrigger;
    const menu = typeahead.menu;

    const applyMention = useCallback(
      (suggestion: PromptMentionSuggestion) => {
        const trigger = activeTrigger;
        if (!trigger || trigger.kind !== "mention") return;
        const insertion = mentionInsertionFromSuggestion(
          suggestion,
          trigger.char,
        );
        const current = valueRef.current;
        const result = insertMention(current, {
          from: trigger.from,
          to: trigger.to,
          ...insertion,
          trailingText: hasWhitespaceAt(current.text, trigger.to) ? "" : " ",
        });
        commit(result.value, result.caret);
      },
      [activeTrigger, commit],
    );

    const applyCommand = useCallback(
      (suggestion: ProviderCommandSuggestion) => {
        const trigger = activeTrigger;
        if (!trigger || trigger.kind !== "command") return;
        const insertion = commandInsertionFromSuggestion(
          suggestion,
          trigger.char,
        );
        const current = valueRef.current;
        const result = insertMention(current, {
          from: trigger.from,
          to: trigger.to,
          ...insertion,
          trailingText: hasWhitespaceAt(current.text, trigger.to) ? "" : " ",
        });
        commit(result.value, result.caret);
      },
      [activeTrigger, commit],
    );

    const insertAtCaret = useCallback(
      (rawText: string) => {
        const text = rawText.replace(/\s+/g, " ").trim();
        if (text.length === 0) return;
        const current = valueRef.current;
        const caret = Math.min(
          inputRef.current?.getSelection().start ?? current.text.length,
          current.text.length,
        );
        const before = current.text.slice(0, caret);
        const after = current.text.slice(caret);
        const lead = before.length > 0 && !/\s$/u.test(before) ? " " : "";
        const trail = after.length > 0 && !/^\s/u.test(after) ? " " : "";
        const inserted = `${lead}${text}${trail}`;
        commit(insertText(current, caret, inserted), caret + inserted.length);
      },
      [commit],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputRef.current?.focus(),
        blur: () => inputRef.current?.blur(),
        insertText: insertAtCaret,
      }),
      [insertAtCaret],
    );

    // --- Attachments --------------------------------------------------------
    const attachmentsController = useComposerAttachments({
      projectId: scope.projectId,
      attachments,
      onAttachmentsChange,
    });
    const resolveImageUrl = useCallback(
      (attachment: PromptDraftAttachment) =>
        scope.projectId
          ? buildProjectAttachmentContentUrl(
              serverUrl,
              scope.projectId,
              attachment.path,
            )
          : null,
      [scope.projectId, serverUrl],
    );

    // --- Voice --------------------------------------------------------------
    const voice = useComposerVoice({
      enabled: systemConfig.data?.voiceTranscriptionEnabled ?? false,
      getPromptContext: () => {
        const caret = inputRef.current?.getSelection().start ?? 0;
        const before = valueRef.current.text.slice(0, caret).trim();
        return before.length > 0 ? before : undefined;
      },
      onTranscript: insertAtCaret,
    });
    const voiceBusy =
      voice.state === "recording" || voice.state === "transcribing";

    // --- "+" menu -----------------------------------------------------------
    const actionsSheet = useSheet();
    const applyPromptAction = usePromptActionApplier({
      valueRef,
      inputRef,
      commit,
    });
    const sheetActions = useMemo((): ActionSheetAction[] => {
      const rows: ActionSheetAction[] = [
        {
          key: "photo-library",
          label: "Photo library",
          icon: "Eye",
          disabled: scope.projectId === null,
          onPress: () => void attachmentsController.pickFromLibrary(),
        },
        {
          key: "camera",
          label: "Take photo",
          icon: "Smartphone",
          disabled: scope.projectId === null,
          onPress: () => void attachmentsController.takePhoto(),
        },
        {
          key: "file",
          label: "Attach file",
          icon: "Paperclip",
          disabled: scope.projectId === null,
          onPress: () => void attachmentsController.pickDocument(),
        },
      ];
      for (const action of promptActionModel.actions) {
        const presentation = PROMPT_ACTION_PRESENTATION[action.kind];
        rows.push({
          key: `prompt-${action.kind}`,
          label: action.label ?? presentation.label,
          icon: presentation.icon,
          disabled: action.disabled,
          onPress: () => applyPromptAction(action),
        });
      }
      for (const action of actions) {
        rows.push({
          key: `screen-${action.key}`,
          label: action.label,
          icon: action.icon,
          destructive: action.destructive,
          disabled: action.disabled,
          onPress: action.onPress,
        });
      }
      return rows;
    }, [
      actions,
      applyPromptAction,
      attachmentsController,
      promptActionModel.actions,
      scope.projectId,
    ]);

    // --- Submit -------------------------------------------------------------
    const hasInput = hasComposerText(value) || attachments.length > 0;
    const affordance = resolveSubmitAffordance({
      mode: submitMode,
      hasInput,
      isSubmitting,
      disabled: disabled || attachmentsController.isUploading || voiceBusy,
      readyLabel: submitLabel,
    });
    const submit = useCallback(
      (kind: ComposerSubmitKind) => {
        haptic("impact-medium");
        void onSubmit(kind);
      },
      [onSubmit],
    );
    const showVoicePrimary =
      voice.enabled && !hasInput && !isSubmitting && !disabled;

    const menuNode = menu ? (
      <TypeaheadMenu
        menu={menu}
        onPickMention={applyMention}
        onPickCommand={applyCommand}
        testID={`${testID}-typeahead`}
      />
    ) : null;

    return (
      <View style={{ position: "relative", zIndex: 10 }} testID={testID}>
        {menuNode && typeaheadPlacement === "above" ? (
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: "100%",
              marginBottom: 6,
              zIndex: 20,
            }}
          >
            {menuNode}
          </View>
        ) : null}
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: focused ? tokens.ring : tokens.input,
            backgroundColor: tokens.card,
          }}
        >
          {header}
          <AttachmentChips
            attachments={attachments}
            pending={attachmentsController.pending}
            previewUriByPath={attachmentsController.previewUriByPath}
            resolveImageUrl={resolveImageUrl}
            onRemove={attachmentsController.remove}
            disabled={disabled || isSubmitting}
            testID={`${testID}-attachments`}
          />
          <ComposerInput
            ref={inputRef}
            value={value}
            onChange={commit}
            onSelectionChange={setSelection}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            editable={!disabled && !voiceBusy}
            autoFocus={autoFocus}
            minHeight={minInputHeight}
            testID={`${testID}-input`}
          />
          {menuNode && typeaheadPlacement === "below" ? (
            <View style={{ paddingHorizontal: 8, paddingBottom: 8 }}>
              {menuNode}
            </View>
          ) : null}
          {voiceBusy ? (
            <VoiceBar voice={voice} />
          ) : (
            <View
              className="flex-row items-center gap-2 px-2 pb-2"
              testID={`${testID}-footer`}
            >
              <Button
                variant="ghost"
                size="icon"
                icon="Plus"
                accessibilityLabel="Prompt actions"
                disabled={disabled || isSubmitting}
                loading={attachmentsController.isUploading}
                onPress={actionsSheet.present}
                testID={`${testID}-actions`}
              />
              <View style={{ flex: 1, minWidth: 0, flexDirection: "row" }}>
                {executionControls ? (
                  <ExecutionControls
                    {...executionControls}
                    disabled={
                      executionControls.disabled || disabled || isSubmitting
                    }
                  />
                ) : null}
              </View>
              {footerAccessory}
              {affordance.stop ? (
                <Button
                  variant="secondary"
                  size="icon"
                  icon="Square"
                  accessibilityLabel="Stop"
                  haptic
                  onPress={affordance.stop}
                  testID={`${testID}-stop`}
                />
              ) : null}
              {showVoicePrimary ? (
                <Button
                  size="icon"
                  icon="Mic"
                  accessibilityLabel="Voice input"
                  haptic
                  onPress={() => void voice.start()}
                  testID={`${testID}-voice`}
                />
              ) : affordance.kind !== null || !affordance.stop ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={affordance.label}
                  accessibilityState={{ disabled: affordance.disabled }}
                  disabled={affordance.disabled || affordance.kind === null}
                  onPress={() => {
                    if (affordance.kind) submit(affordance.kind);
                  }}
                  onLongPress={
                    affordance.longPressSteer
                      ? () => submit("steer")
                      : undefined
                  }
                  delayLongPress={350}
                  testID={`${testID}-submit`}
                  style={({ pressed }) => ({
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: affordance.disabled
                      ? tokens.muted
                      : tokens.foreground,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  {affordance.icon === "Spinner" ? (
                    <Spinner
                      color={
                        affordance.disabled
                          ? tokens.mutedForeground
                          : tokens.background
                      }
                    />
                  ) : (
                    <Icon
                      name={affordance.icon}
                      size={20}
                      color={
                        affordance.disabled
                          ? tokens.mutedForeground
                          : tokens.background
                      }
                    />
                  )}
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
        <ActionSheet
          controller={actionsSheet}
          title="Add to prompt"
          actions={sheetActions}
        />
      </View>
    );
  },
);

/**
 * Applies a "+" prompt action at the caret and refocuses the input. Lives
 * outside the component so the render-time menu model can hold it without
 * the compiler lint reading it as a render-time ref access.
 */
function usePromptActionApplier({
  valueRef,
  inputRef,
  commit,
}: {
  valueRef: React.RefObject<ComposerValue>;
  inputRef: React.RefObject<ComposerInputHandle | null>;
  commit: (next: ComposerValue, caret?: number) => void;
}): (action: ComposerPromptAction) => void {
  return useCallback(
    (action: ComposerPromptAction) => {
      const current = valueRef.current;
      const caret = Math.min(
        inputRef.current?.getSelection().start ?? current.text.length,
        current.text.length,
      );
      const result = resolvePromptActionInsertion(current, caret, action);
      if (result) commit(result.value, result.caret);
      inputRef.current?.focus();
    },
    [commit, inputRef, valueRef],
  );
}

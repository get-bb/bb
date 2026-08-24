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
  type RefObject,
} from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { haptic } from "@/lib/haptics";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { buildProjectAttachmentContentUrl } from "@/data/thread-detail";
import { useSystemConfig, useSystemProviders } from "@/data/system";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Button,
  Icon,
  LONG_PRESS_DELAY_MS,
  SheetPresenceContext,
  Spinner,
  useOverlayBounds,
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
  resolveTypeaheadMaxHeight,
  TYPEAHEAD_GAP,
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
  /**
   * Pill row rendered above the input while expanded (the home dock's
   * project / environment pickers). Hidden in the collapsed pill.
   */
  topControls?: ReactNode;
  /** Small trailing element in the footer (context-window readout). */
  footerAccessory?: ReactNode;
  /**
   * Collapse to a one-line pill ("+ · placeholder · mic") while unfocused
   * and empty; focus expands the card (top controls, the footer pills, the
   * submit button) and blur folds it again. A picker sheet opened from the
   * card keeps it expanded and refocuses the input when it closes.
   */
  collapsible?: boolean;
  /** Reports pill ↔ card transitions (the home screen drives its scrim). */
  onExpandedChange?: (expanded: boolean) => void;
  /**
   * Where the suggestion list opens. `above` floats over whatever sits above
   * the card (thread screen, composer at the bottom); `below` renders inline
   * under the input (the dev showcase, composer near the top of a scroll view).
   */
  typeaheadPlacement?: "above" | "below";
  minInputHeight?: number;
  testID?: string;
}

const EMPTY_ACTIONS: readonly ComposerAction[] = [];

/** A blur this close before a sheet opens is the sheet's keyboard dismissal. */
const BLUR_FOR_SHEET_MS = 600;

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
      topControls,
      footerAccessory,
      collapsible = false,
      onExpandedChange,
      typeaheadPlacement = "above",
      minInputHeight,
      testID = "composer",
    },
    ref,
  ) {
    const { tokens } = useTheme();
    const { serverUrl } = useProfileClient();
    const inputRef = useRef<ComposerInputHandle>(null);
    const rootRef = useRef<View>(null);
    const valueRef = useRef(value);
    useEffect(() => {
      valueRef.current = value;
    }, [value]);
    const [selection, setSelection] = useState<TextSelection>({
      start: 0,
      end: 0,
    });
    const [focused, setFocused] = useState(false);
    // Sheets presented from inside the card (pickers, the "+" menu). They
    // dismiss the keyboard, which must not fold the card; when the last
    // one closes the input takes focus back.
    const [openSheetCount, setOpenSheetCount] = useState(0);
    const sheetOpen = openSheetCount > 0;
    const refocusAfterSheetRef = useRef(false);
    const lastBlurAtRef = useRef(0);
    const onSheetPresenceChange = useCallback((open: boolean) => {
      setOpenSheetCount((count) => Math.max(0, count + (open ? 1 : -1)));
      // The keyboard dismissal a sheet triggers reaches the input either
      // before or after the sheet reports itself open; either order arms
      // the refocus.
      if (open && Date.now() - lastBlurAtRef.current < BLUR_FOR_SHEET_MS) {
        refocusAfterSheetRef.current = true;
      }
    }, []);
    const sheetPresence = useMemo(
      () => ({ onPresenceChange: onSheetPresenceChange }),
      [onSheetPresenceChange],
    );
    const handleFocus = useCallback(() => setFocused(true), []);
    const handleBlur = useCallback(() => {
      setFocused(false);
      lastBlurAtRef.current = Date.now();
      if (sheetOpen) refocusAfterSheetRef.current = true;
    }, [sheetOpen]);
    useEffect(() => {
      if (sheetOpen || !refocusAfterSheetRef.current) return;
      refocusAfterSheetRef.current = false;
      inputRef.current?.focus();
    }, [sheetOpen]);
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
    // Only the floating list is bounded by the room above the card; the
    // inline `below` list is part of the card and must not feed back into
    // its own anchor.
    const { spaceAbove, measureSpaceAbove } = useSpaceAboveCard({
      rootRef,
      enabled: typeaheadPlacement === "above",
      menuOpen: menu !== null,
    });
    const typeaheadMaxHeight = resolveTypeaheadMaxHeight(spaceAbove);

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
    // Focus, text, attachments, an edit header, a voice session, or a sheet
    // opened from the card keep the full card; otherwise the pill folds.
    const collapsed =
      collapsible &&
      !focused &&
      !sheetOpen &&
      !hasInput &&
      attachments.length === 0 &&
      header == null &&
      !voiceBusy;
    const expanded = !collapsed;
    const lastExpandedRef = useRef<boolean | null>(null);
    useEffect(() => {
      if (lastExpandedRef.current === expanded) return;
      lastExpandedRef.current = expanded;
      onExpandedChange?.(expanded);
    }, [expanded, onExpandedChange]);

    const menuNode = menu ? (
      <TypeaheadMenu
        menu={menu}
        onPickMention={applyMention}
        onPickCommand={applyCommand}
        maxHeight={typeaheadMaxHeight}
        testID={`${testID}-typeahead`}
      />
    ) : null;

    return (
      <SheetPresenceContext.Provider value={sheetPresence}>
        <View
          ref={rootRef}
          collapsable={false}
          onLayout={measureSpaceAbove}
          style={{ position: "relative", zIndex: 10 }}
          testID={testID}
        >
          {menuNode && typeaheadPlacement === "above" ? (
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "100%",
                marginBottom: TYPEAHEAD_GAP,
                zIndex: 20,
              }}
            >
              {menuNode}
            </View>
          ) : null}
          <View
            style={{
              borderRadius: collapsed ? 26 : 22,
              borderWidth: 1,
              borderColor: focused && !collapsed ? tokens.ring : tokens.input,
              backgroundColor: tokens.card,
              paddingHorizontal: collapsed ? 6 : 0,
            }}
            testID={`${testID}-card`}
            accessibilityState={
              collapsible ? { expanded: !collapsed } : undefined
            }
          >
            {header}
            {!collapsed && topControls ? (
              <View
                className="flex-row items-center px-2 pt-2"
                testID={`${testID}-top-controls`}
              >
                {topControls}
              </View>
            ) : null}
            <AttachmentChips
              attachments={attachments}
              pending={attachmentsController.pending}
              previewUriByPath={attachmentsController.previewUriByPath}
              resolveImageUrl={resolveImageUrl}
              onRemove={attachmentsController.remove}
              disabled={disabled || isSubmitting}
              testID={`${testID}-attachments`}
            />
            {/* The input keeps its tree position in both layouts so the pill
              → card transition never remounts it (that would drop focus). */}
            <View className="flex-row items-center">
              {collapsed ? (
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
              ) : null}
              <View className="min-w-0 flex-1">
                <ComposerInput
                  ref={inputRef}
                  value={value}
                  onChange={commit}
                  onSelectionChange={setSelection}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  placeholder={placeholder}
                  editable={!disabled && !voiceBusy}
                  minHeight={
                    collapsed
                      ? undefined
                      : (minInputHeight ?? (collapsible ? 64 : undefined))
                  }
                  pill={collapsed}
                  testID={`${testID}-input`}
                />
              </View>
              {/* Collapsed right slot: Stop while a turn runs (it must stay
                  reachable without expanding), else the mic, else a spacer. */}
              {collapsed && affordance.stop ? (
                <StopButton
                  onPress={affordance.stop}
                  // The 44pt input row leaves 4pt above and below the 36pt
                  // circle. Pull the circle 2pt into the card's 6pt padding so
                  // the right gap is also 4pt and the circle sits concentric
                  // with the pill's corner.
                  style={{ marginRight: -2 }}
                  testID={`${testID}-stop`}
                />
              ) : collapsed && showVoicePrimary ? (
                <Button
                  variant="ghost"
                  size="icon"
                  icon="Mic"
                  accessibilityLabel="Voice input"
                  haptic
                  onPress={() => void voice.start()}
                  testID={`${testID}-voice`}
                />
              ) : collapsed ? (
                <View style={{ width: 10 }} />
              ) : null}
            </View>
            {menuNode && typeaheadPlacement === "below" ? (
              <View style={{ paddingHorizontal: 8, paddingBottom: 8 }}>
                {menuNode}
              </View>
            ) : null}
            {collapsed ? null : voiceBusy ? (
              <VoiceBar voice={voice} />
            ) : (
              <View
                className="flex-row items-center gap-1 px-2 pb-2"
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
                  <StopButton
                    onPress={affordance.stop}
                    testID={`${testID}-stop`}
                  />
                ) : null}
                {showVoicePrimary ? (
                  <Button
                    variant="ghost"
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
                    delayLongPress={LONG_PRESS_DELAY_MS}
                    testID={`${testID}-submit`}
                    style={({ pressed }) => ({
                      width: 36,
                      height: 36,
                      borderRadius: 18,
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
                        size={18}
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
      </SheetPresenceContext.Provider>
    );
  },
);

/**
 * The distance from the top of the overlay bounds (the screen content under
 * the native header) to the top of the composer root, for the typeahead's
 * height cap. Re-measured on the root's own layout (the card grows with the
 * text), on the bounds' layout (keyboard frame, rotation) and when the menu
 * opens. `null` while disabled, without a bounds provider, or before the
 * first measurement.
 */
function useSpaceAboveCard({
  rootRef,
  enabled,
  menuOpen,
}: {
  rootRef: RefObject<View | null>;
  enabled: boolean;
  menuOpen: boolean;
}): { spaceAbove: number | null; measureSpaceAbove: () => void } {
  const { ref: boundsRef, layoutVersion: boundsLayoutVersion } =
    useOverlayBounds();
  const [spaceAbove, setSpaceAbove] = useState<number | null>(null);
  const measureSpaceAbove = useCallback(() => {
    const root = rootRef.current;
    const target = boundsRef.current;
    if (!enabled || !root || !target) return;
    root.measureLayout(
      target,
      (_x, y) => setSpaceAbove(y),
      () => undefined,
    );
  }, [boundsRef, enabled, rootRef]);
  useEffect(() => {
    measureSpaceAbove();
  }, [measureSpaceAbove, boundsLayoutVersion, menuOpen]);
  return { spaceAbove, measureSpaceAbove };
}

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

/**
 * Round "stop the run" button, the same 36pt circle as the send button so the
 * collapsed pill and the expanded footer keep one silhouette. A filled square
 * (web: `Square` with `fill-current`), not the stroked icon, reads as stop.
 */
function StopButton({
  onPress,
  style,
  testID,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID: string;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Stop"
      hitSlop={4}
      onPress={() => {
        haptic("impact-medium");
        onPress();
      }}
      testID={testID}
      style={({ pressed }) => [
        {
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tokens.secondary,
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: 2,
          backgroundColor: tokens.secondaryForeground,
        }}
      />
    </Pressable>
  );
}

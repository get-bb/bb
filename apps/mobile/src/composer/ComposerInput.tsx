import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Platform,
  Text as RNText,
  TextInput,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { withAlpha } from "@/markdown/colors";
import { resolveFont, useTheme } from "@/theme";
import { nativeTypography } from "@/theme/theme.native";
import {
  applyTextChange,
  type ComposerValue,
  type TextSelection,
} from "./model";

export interface ComposerInputHandle {
  focus: () => void;
  blur: () => void;
  isFocused: () => boolean;
  /** The last selection the native input reported. */
  getSelection: () => TextSelection;
}

export interface ComposerInputProps {
  value: ComposerValue;
  /**
   * The model after reconciling a native edit. `caret` is where the caret
   * lands (display offset); the parent stores it for typeahead detection.
   */
  onChange: (value: ComposerValue, caret: number) => void;
  onSelectionChange: (selection: TextSelection) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  editable?: boolean;
  autoFocus?: boolean;
  minHeight?: number;
  /**
   * One-line pill mode: nudge the text up so its x-height centre lines up
   * with the 40px buttons beside it (iOS sits the glyphs low inside an
   * explicit lineHeight box).
   */
  pill?: boolean;
  testID?: string;
}

const FONT_SIZE = nativeTypography.base.fontSize;
const LINE_HEIGHT = nativeTypography.base.lineHeight;
const VERTICAL_PADDING = 10;
/** Grow up to this many lines, then scroll. */
const MAX_LINES = 8;
const HORIZONTAL_PADDING = 12;
const PILL_BASELINE_NUDGE = Platform.OS === "ios" ? 3 : 0;

/**
 * The composer's text field: a multiline `TextInput` whose content is
 * rendered as nested `Text` spans so mention ranges paint as pills while the
 * caret, selection, autocorrect and dictation keep working natively. The
 * native text is the source of truth for typing; every `onChangeText` is
 * reconciled against the model (`applyTextChange`) so pills stay atomic —
 * when that reconciliation removes a pill, the new model text is pushed back
 * into the input through the children (iOS keeps the caret relative to the
 * end of the old text, which lands it where the pill was).
 *
 * Android renders plain text (the value prop) until styled ranges are
 * verified there; the model and behavior are identical.
 */
export const ComposerInput = forwardRef<
  ComposerInputHandle,
  ComposerInputProps
>(function ComposerInput(
  {
    value,
    onChange,
    onSelectionChange,
    onFocus,
    onBlur,
    placeholder = "What should the agent do?",
    editable = true,
    autoFocus = false,
    minHeight,
    pill = false,
    testID = "composer-input",
  },
  ref,
) {
  const { tokens } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const selectionRef = useRef<TextSelection>({ start: 0, end: 0 });
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  const [contentHeight, setContentHeight] = useState(0);
  const focusedRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      isFocused: () => focusedRef.current,
      getSelection: () => selectionRef.current,
    }),
    [],
  );

  const handleChangeText = useCallback(
    (nextText: string) => {
      const current = valueRef.current;
      if (nextText === current.text) return;
      const result = applyTextChange(current, nextText, selectionRef.current);
      // The caret implied by the edit; a subsequent onSelectionChange (if
      // native fires one) refines it.
      selectionRef.current = { start: result.caret, end: result.caret };
      onSelectionChange(selectionRef.current);
      valueRef.current = result.value;
      onChange(result.value, result.caret);
    },
    [onChange, onSelectionChange],
  );

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const { start, end } = event.nativeEvent.selection;
      const length = valueRef.current.text.length;
      const next = {
        start: Math.max(0, Math.min(start, length)),
        end: Math.max(0, Math.min(end, length)),
      };
      selectionRef.current = next;
      onSelectionChange(next);
    },
    [onSelectionChange],
  );

  const handleContentSizeChange = useCallback(
    (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      setContentHeight(event.nativeEvent.contentSize.height);
    },
    [],
  );

  const font = resolveFont({});
  const pillFont = resolveFont({ weight: "medium" });
  const maxHeight = MAX_LINES * LINE_HEIGHT + VERTICAL_PADDING * 2;
  const effectiveMinHeight = Math.max(
    minHeight ?? LINE_HEIGHT + VERTICAL_PADDING * 2,
    LINE_HEIGHT + VERTICAL_PADDING * 2,
  );
  const scrollEnabled = contentHeight > maxHeight - VERTICAL_PADDING;

  const children = useMemo(() => {
    if (Platform.OS !== "ios") return null;
    const spans: React.ReactNode[] = [];
    let cursor = 0;
    value.mentions.forEach((mention, index) => {
      if (mention.start > cursor) {
        spans.push(
          <RNText key={`t${index}`}>
            {value.text.slice(cursor, mention.start)}
          </RNText>,
        );
      }
      spans.push(
        <RNText
          key={`m${index}`}
          style={{
            color: tokens.primary,
            backgroundColor: withAlpha(tokens.primary, 0.12),
            fontFamily: pillFont.fontFamily,
            fontWeight: pillFont.fontWeight,
          }}
        >
          {value.text.slice(mention.start, mention.end)}
        </RNText>,
      );
      cursor = mention.end;
    });
    if (cursor < value.text.length) {
      spans.push(<RNText key="tail">{value.text.slice(cursor)}</RNText>);
    }
    return <RNText>{spans}</RNText>;
  }, [pillFont.fontFamily, pillFont.fontWeight, tokens.primary, value]);

  return (
    <TextInput
      ref={inputRef}
      {...(Platform.OS === "ios" ? {} : { value: value.text })}
      onChangeText={handleChangeText}
      onSelectionChange={handleSelectionChange}
      onContentSizeChange={handleContentSizeChange}
      onFocus={() => {
        focusedRef.current = true;
        onFocus?.();
      }}
      onBlur={() => {
        focusedRef.current = false;
        onBlur?.();
      }}
      placeholder={placeholder}
      placeholderTextColor={tokens.mutedForeground}
      selectionColor={tokens.primary}
      cursorColor={tokens.primary}
      editable={editable}
      autoFocus={autoFocus}
      multiline
      scrollEnabled={scrollEnabled}
      textAlignVertical="top"
      autoCapitalize="sentences"
      keyboardAppearance={undefined}
      style={{
        fontFamily: font.fontFamily,
        fontWeight: font.fontWeight,
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
        color: tokens.foreground,
        paddingTop: VERTICAL_PADDING - (pill ? PILL_BASELINE_NUDGE : 0),
        paddingBottom: VERTICAL_PADDING + (pill ? PILL_BASELINE_NUDGE : 0),
        paddingHorizontal: HORIZONTAL_PADDING,
        minHeight: effectiveMinHeight,
        maxHeight,
        opacity: editable ? 1 : 0.6,
      }}
      accessibilityLabel="Prompt"
      testID={testID}
    >
      {children}
    </TextInput>
  );
});

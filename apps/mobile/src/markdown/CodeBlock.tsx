import * as Clipboard from "expo-clipboard";
import { memo, useMemo } from "react";
import { Pressable, ScrollView, Text as RNText, View } from "react-native";
import { FONT_FAMILIES } from "@/theme/fonts";
import { nativeTypography } from "@/theme/theme.native";
import { Icon } from "@/ui/Icon";
import { LONG_PRESS_DELAY_MS } from "@/ui/long-press";
import { toast } from "@/ui/Toast";
import {
  codeTokenColor,
  normalizeCodeLanguage,
  tokenizeCodeLines,
} from "./code";
import { useMarkdownContext } from "./MarkdownContext";

export interface CodeBlockProps {
  code: string;
  language: string | null;
  /** Shown in the header instead of the language (math blocks). */
  label?: string;
}

/** Default copy handler: clipboard + toast. */
function copyCodeToClipboard(code: string): void {
  void Clipboard.setStringAsync(code)
    .then(() => {
      toast.success("Copied");
    })
    .catch(() => {
      toast.error("Could not copy");
    });
}

/**
 * Fenced code: language label + copy button header, horizontally scrolling
 * monospace body with sugar-high token colours. Long-press anywhere copies.
 */
export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  label,
}: CodeBlockProps) {
  const ctx = useMarkdownContext();
  const { tokens, mode } = ctx;
  const normalizedLanguage = normalizeCodeLanguage(language);
  const lines = useMemo(
    () => tokenizeCodeLines(code, normalizedLanguage),
    [code, normalizedLanguage],
  );
  const copy = () => {
    copyCodeToClipboard(code);
  };
  const mono = nativeTypography.xs;
  const headerLabel = label ?? normalizedLanguage ?? "";

  return (
    <Pressable
      onLongPress={copy}
      accessibilityHint="Long press to copy"
      style={{
        borderRadius: 6,
        borderWidth: 1,
        borderColor: tokens.border,
        backgroundColor: tokens.surfaceRecessed,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: 12,
          paddingRight: 4,
          paddingTop: 4,
        }}
      >
        <RNText
          numberOfLines={1}
          style={{
            fontFamily: FONT_FAMILIES.mono.regular,
            fontWeight: "400",
            fontSize: nativeTypography["2xs"].fontSize,
            lineHeight: nativeTypography["2xs"].lineHeight,
            color: tokens.mutedForeground,
            textTransform: "uppercase",
            flexShrink: 1,
          }}
        >
          {headerLabel}
        </RNText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy code"
          hitSlop={8}
          onPress={copy}
          style={({ pressed }) => ({
            padding: 6,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon name="Copy" size={14} color={tokens.mutedForeground} />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
      >
        {/*
          The body gets its own Pressable inside the ScrollView, and the
          body padding sits on it so a drag that starts in a gutter hits it
          too. With only the outer Pressable (an ancestor of the ScrollView)
          as responder, the new architecture never lets the ScrollView scroll
          sideways. See MarkdownTable.
        */}
        <Pressable
          accessible={false}
          onLongPress={copy}
          delayLongPress={LONG_PRESS_DELAY_MS}
          style={{ paddingHorizontal: 12, paddingBottom: 10, paddingTop: 2 }}
        >
          <RNText
            selectable={ctx.selectable}
            style={{
              fontFamily: FONT_FAMILIES.mono.regular,
              fontWeight: "400",
              fontSize: mono.fontSize,
              lineHeight: mono.lineHeight,
              color: tokens.foreground,
            }}
          >
            {lines.map((line, lineIndex) => (
              <RNText key={lineIndex}>
                {line.map((span, spanIndex) => (
                  <RNText
                    key={spanIndex}
                    style={{
                      color: codeTokenColor(span.type, mode, tokens),
                    }}
                  >
                    {span.text}
                  </RNText>
                ))}
                {lineIndex < lines.length - 1 ? "\n" : null}
              </RNText>
            ))}
          </RNText>
        </Pressable>
      </ScrollView>
    </Pressable>
  );
});

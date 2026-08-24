import { memo } from "react";
import { Pressable, Text as RNText } from "react-native";
import type { PromptMentionResource } from "@bb/domain";
import { resolveFont } from "@/theme/fonts";
import { nativeTypography } from "@/theme/theme.native";
import { Icon } from "@/ui/Icon";
import { withAlpha } from "./colors";
import { useMarkdownContext } from "./MarkdownContext";
import {
  promptMentionAccessibilityLabel,
  promptMentionIconName,
} from "./mention-display";

export interface MentionPillProps {
  resource: PromptMentionResource;
  onPress?: () => void;
}

/**
 * Inline mention pill (thread / path / command / plugin …) laid out as a
 * view inside the surrounding `Text` so it flows with prose. Mirrors the
 * web `PromptMentionPill` chrome: rounded, hairline border, kind icon, label.
 */
export const MentionPill = memo(function MentionPill({
  resource,
  onPress,
}: MentionPillProps) {
  const { tokens, textSize } = useMarkdownContext();
  const body = nativeTypography[textSize];
  const font = resolveFont({ className: "text-xs" });
  const label = promptMentionAccessibilityLabel(resource);
  return (
    <Pressable
      accessibilityRole={onPress ? "link" : "text"}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={onPress === undefined}
      hitSlop={4}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingLeft: 4,
        paddingRight: 6,
        paddingVertical: 1,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: tokens.pillSurfaceBorder,
        backgroundColor: withAlpha(tokens.surfaceRaisedSolid, 0.5),
        transform: [{ translateY: 3 }],
        maxWidth: 260,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon
        name={promptMentionIconName(resource)}
        size={13}
        color={tokens.pillIcon}
      />
      <RNText
        numberOfLines={1}
        style={{
          fontFamily: font.fontFamily,
          fontWeight: font.fontWeight,
          fontSize: nativeTypography.xs.fontSize,
          lineHeight: Math.min(nativeTypography.xs.lineHeight, body.lineHeight),
          color: tokens.pillForeground,
        }}
      >
        {resource.label}
      </RNText>
    </Pressable>
  );
});

import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { useTheme } from "@/theme";
import { Icon, Text } from "@/ui";
import { threadHref } from "../../shell/hrefs";

const IS_IOS = process.env.EXPO_OS === "ios";

export interface InteractionSourceThread {
  threadId: string;
  title: string;
}

interface InteractionBannerShellProps {
  /** Heading line. Omitted when the body supplies its own (question forms). */
  title?: string;
  /** Secondary line under the title ("Requested by secrets"). */
  subtitle?: string;
  /** Set when the interaction belongs to a child thread of the open one. */
  sourceThread?: InteractionSourceThread;
  errorMessage?: string | null;
  footer?: ReactNode;
  children?: ReactNode;
  testID?: string;
}

/** Card corners: continuous 12pt (the grouped inset-card look). */
const CARD_STYLE = { borderRadius: 12, borderCurve: "continuous" } as const;

/**
 * Frame shared by every pending-interaction banner (mirrors the web
 * `BannerShell` in ThreadPendingInteractionBanner.tsx): recessed card, an
 * optional "From child thread" link, title, body, right-aligned footer
 * actions, and the inline mutation error. It rises in and drops out as
 * the interaction arrives / resolves.
 */
export function InteractionBannerShell({
  title,
  subtitle,
  sourceThread,
  errorMessage,
  footer,
  children,
  testID,
}: InteractionBannerShellProps) {
  const router = useRouter();
  const { tokens } = useTheme();
  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      exiting={FadeOutDown.duration(160)}
      // Plain style tokens: the animated view sits outside the className
      // interop, and Reanimated wants string colors anyway.
      style={[
        CARD_STYLE,
        {
          overflow: "hidden",
          borderWidth: 1,
          borderColor: tokens.border,
          backgroundColor: tokens.surfaceRecessed,
          paddingHorizontal: 16,
          paddingVertical: 12,
        },
      ]}
      testID={testID}
      accessibilityLiveRegion="polite"
    >
      {sourceThread ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open child thread ${sourceThread.title}`}
          onPress={() => router.push(threadHref(sourceThread.threadId))}
          className="mb-1 flex-row items-center gap-1 active:opacity-70"
          testID="interaction-banner-source-thread"
        >
          <Icon
            name="CornerDownRight"
            size={12}
            color={tokens.mutedForeground}
          />
          <Text variant="caption" numberOfLines={1} className="min-w-0 flex-1">
            From child thread: {sourceThread.title}
          </Text>
        </Pressable>
      ) : null}
      {title ? (
        <Text
          // The 17/600 headline on iOS; the web's 15/600 elsewhere.
          variant={IS_IOS ? "headline" : undefined}
          className={IS_IOS ? undefined : "text-sm font-semibold"}
          numberOfLines={3}
          testID="interaction-banner-title"
        >
          {title}
        </Text>
      ) : null}
      {subtitle ? (
        <Text variant="caption" className="mt-0.5" numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      {children ? (
        <View className={title || subtitle ? "mt-3" : undefined}>
          {children}
        </View>
      ) : null}
      {footer ? (
        <View className="mt-3 flex-row flex-wrap items-center justify-end gap-2">
          {footer}
        </View>
      ) : null}
      {errorMessage ? (
        <View
          className="mt-2 rounded-md border border-surface-destructive-border bg-surface-destructive px-2 py-1"
          style={{ borderCurve: "continuous" }}
          accessibilityRole="alert"
          testID="interaction-banner-error"
        >
          <Text className="text-xs text-destructive-text">{errorMessage}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

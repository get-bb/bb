import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { Icon, Text } from "@/ui";
import { threadHref } from "../../shell/hrefs";

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

/**
 * Frame shared by every pending-interaction banner (mirrors the web
 * `BannerShell` in ThreadPendingInteractionBanner.tsx): recessed card, an
 * optional "From child thread" link, title, body, right-aligned footer
 * actions, and the inline mutation error.
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
    <View
      className="overflow-hidden rounded-lg border border-border bg-surface-recessed px-4 py-3"
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
          className="text-sm font-semibold"
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
          accessibilityRole="alert"
          testID="interaction-banner-error"
        >
          <Text className="text-xs text-destructive-text">{errorMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

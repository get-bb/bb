import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { useConnectionBanner, useProfiles } from "@/app-shell";
import type { ConnectionBannerKind } from "@/lib/connection";
import { Icon, Text, cn, type IconName } from "@/ui";
import { useTheme } from "@/theme";
import { connectEnrollHref } from "./hrefs";

interface BannerCopy {
  icon: IconName;
  message: (label: string) => string;
  destructive: boolean;
}

const COPY: Record<Exclude<ConnectionBannerKind, "hidden">, BannerCopy> = {
  connecting: {
    icon: "Loading",
    message: (label) => `Connecting to ${label}…`,
    destructive: false,
  },
  reconnecting: {
    icon: "ArrowReloadHorizontal",
    message: (label) => `Connection to ${label} lost. Reconnecting…`,
    destructive: false,
  },
  "auth-required": {
    icon: "Lock",
    message: (label) => `${label} needs to be paired again.`,
    destructive: true,
  },
  "auth-error": {
    icon: "AlertTriangle",
    message: (label) => `Could not sign in to ${label}. Retrying…`,
    destructive: false,
  },
};

/**
 * Persistent strip under the header while the active profile is not
 * connected (offline, server restart, connect session trouble). Renders
 * nothing when the socket is up. `auth-required` (the connect gate refused
 * this phone's credential: revoked in the dashboard, or the account's
 * device list was pruned) offers "Sign in again", which re-pairs the same
 * profile with a fresh code.
 */
export function ConnectionBanner() {
  const router = useRouter();
  const kind = useConnectionBanner();
  const { activeProfile } = useProfiles();
  const { tokens } = useTheme();
  if (kind === "hidden" || !activeProfile) return null;
  const copy = COPY[kind];
  const color = copy.destructive ? tokens.destructiveText : tokens.warningText;
  const reauth =
    kind === "auth-required" && activeProfile.mode === "connect"
      ? () => router.push(connectEnrollHref({ profileId: activeProfile.id }))
      : null;
  const content = (
    <>
      <Icon name={copy.icon} size={16} color={color} />
      <Text
        variant="caption"
        numberOfLines={2}
        className="flex-1"
        style={{ color }}
        testID={`connection-banner-${kind}`}
      >
        {copy.message(activeProfile.label)}
      </Text>
      {reauth ? (
        <View
          className="rounded-md border border-surface-destructive-border px-2 py-1"
          testID="connection-banner-reauth"
        >
          <Text variant="caption" weight="semibold" style={{ color }}>
            Sign in again
          </Text>
        </View>
      ) : null}
    </>
  );
  const className = cn(
    "flex-row items-center gap-2 border-b px-4 py-2",
    copy.destructive
      ? "border-surface-destructive-border bg-surface-destructive"
      : "border-border bg-surface-attention",
  );
  // The whole strip is the action when there is one: a thumb-sized target
  // that does not depend on hitting the small "Sign in again" label.
  return reauth ? (
    <Pressable
      testID="connection-banner"
      accessibilityRole="button"
      accessibilityLabel={`${copy.message(activeProfile.label)} Sign in again`}
      accessibilityLiveRegion="polite"
      onPress={reauth}
      className={className}
    >
      {content}
    </Pressable>
  ) : (
    <View
      testID="connection-banner"
      accessibilityLiveRegion="polite"
      className={className}
    >
      {content}
    </View>
  );
}

import { useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import {
  e2eModeEnabled,
  useProfiles,
  useRealtimeConnectionState,
} from "@/app-shell";
import type { MobileRealtimeConnectionState } from "@/lib/realtime";
import { useTheme } from "@/theme";
import {
  Icon,
  ListRow,
  Separator,
  Sheet,
  Text,
  toast,
  useSheet,
} from "@/ui";
import { archivedThreadsHref } from "./hrefs";
import { workspaceInitials } from "./workspace-initials";

const REALTIME_LABEL: Record<MobileRealtimeConnectionState, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
};

/**
 * The home header's left button: the active server's initials with a
 * realtime dot. It opens the workspace sheet — the server switcher, archived
 * threads, and Settings — which replaces the old left drawer.
 */
export function WorkspaceMenuButton({
  dimmed = false,
}: {
  /** Muted and inert while the home compose dock's scrim is up. */
  dimmed?: boolean;
}) {
  const router = useRouter();
  const { tokens } = useTheme();
  const { profiles, activeProfile, setActiveProfile } = useProfiles();
  const realtimeState = useRealtimeConnectionState();
  const sheet = useSheet();

  const dotColor = !activeProfile
    ? tokens.mutedForeground
    : realtimeState === "connected"
      ? tokens.success
      : realtimeState === "reconnecting"
        ? tokens.warningText
        : tokens.mutedForeground;

  const go = (href: Href) => {
    sheet.dismiss();
    router.push(href);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Workspace menu"
        hitSlop={8}
        disabled={dimmed}
        onPress={sheet.present}
        className="h-10 w-10 items-center justify-center rounded-full active:bg-state-hover"
        style={{ opacity: dimmed ? 0.5 : 1 }}
        testID="home-workspace-menu"
      >
        <View
          className="h-7 w-7 items-center justify-center rounded-full"
          style={{ backgroundColor: tokens.primary }}
        >
          <Text
            variant="chrome"
            style={{ color: tokens.primaryForeground, fontWeight: "700" }}
            testID="home-workspace-initials"
          >
            {workspaceInitials(activeProfile?.label)}
          </Text>
          <View
            className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full border-2 border-background"
            style={{ backgroundColor: dotColor }}
          />
        </View>
      </Pressable>

      <Sheet controller={sheet} deferContent={false}>
        <View className="gap-0.5 px-4 pb-2 pt-1">
          <Text variant="title" numberOfLines={1} testID="workspace-profile-label">
            {activeProfile?.label ?? "bb"}
          </Text>
          <Text variant="chrome">
            {activeProfile ? REALTIME_LABEL[realtimeState] : "No server selected"}
          </Text>
        </View>
        <Separator />
        {profiles.map((profile) => {
          const active = profile.id === activeProfile?.id;
          return (
            <ListRow
              key={profile.id}
              title={profile.label}
              subtitle={profile.mode === "connect" ? "bb connect" : "Direct"}
              leading={profile.mode === "connect" ? "Globe" : "Laptop"}
              selected={active}
              trailing={
                active ? (
                  <Icon name="Check" size={18} color={tokens.foreground} />
                ) : undefined
              }
              onPress={() => {
                sheet.dismiss();
                if (active) return;
                setActiveProfile(profile.id).catch((error: unknown) => {
                  toast.error("Could not switch server", {
                    description: String(error),
                  });
                });
              }}
              testID={`workspace-server-${profile.id}`}
            />
          );
        })}
        <ListRow
          title="Add server"
          leading="Plus"
          onPress={() => go("/settings/servers/add")}
          testID="workspace-add-server"
        />
        <Separator />
        {activeProfile ? (
          <ListRow
            title="Archived threads"
            leading="Archive"
            trailing="chevron"
            onPress={() => go(archivedThreadsHref())}
            testID="workspace-archived"
          />
        ) : null}
        <ListRow
          title="Settings"
          leading="Settings"
          trailing="chevron"
          onPress={() => go("/settings")}
          testID="workspace-settings"
        />
        {e2eModeEnabled ? (
          <ListRow
            title="UI gallery"
            leading="Palette"
            onPress={() => go("/dev/ui")}
            testID="workspace-ui-gallery"
          />
        ) : null}
      </Sheet>
    </>
  );
}

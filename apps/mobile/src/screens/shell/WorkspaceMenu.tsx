import { Stack, useRouter, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import {
  e2eModeEnabled,
  useProfiles,
  useRealtimeConnectionState,
} from "@/app-shell";
import { haptic } from "@/lib/haptics";
import type { MobileRealtimeConnectionState } from "@/lib/realtime";
import { useTheme } from "@/theme";
import { ListRow, Separator, Sheet, Text, toast, useSheet } from "@/ui";
import { archivedThreadsHref } from "./hrefs";
import { workspaceInitials } from "./workspace-initials";

const REALTIME_LABEL: Record<MobileRealtimeConnectionState, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
};

function useSwitchProfile() {
  const { activeProfile, setActiveProfile } = useProfiles();
  return (profileId: string) => {
    if (profileId === activeProfile?.id) return;
    haptic("selection");
    setActiveProfile(profileId).catch((error: unknown) => {
      toast.error("Could not switch server", {
        description: String(error),
      });
    });
  };
}

/**
 * iOS: the workspace menu as a native pull-down on the home header's left
 * — the server switcher (check on the active one), Add server, then
 * Archived threads and Settings. The menu's title carries the realtime
 * state. Rendered from the home route; `Stack.Toolbar` items are native bar
 * buttons, reachable in tests by their labels.
 */
export function WorkspaceToolbar() {
  const router = useRouter();
  const { profiles, activeProfile } = useProfiles();
  const realtimeState = useRealtimeConnectionState();
  const switchProfile = useSwitchProfile();
  const title = activeProfile
    ? `${activeProfile.label} · ${REALTIME_LABEL[realtimeState]}`
    : "No server selected";
  return (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Menu
        icon="person.crop.circle"
        accessibilityLabel="Workspace"
        title={title}
      >
        {profiles.map((profile) => (
          <Stack.Toolbar.MenuAction
            key={profile.id}
            icon={profile.mode === "connect" ? "globe" : "laptopcomputer"}
            subtitle={profile.mode === "connect" ? "bb connect" : "Direct"}
            isOn={profile.id === activeProfile?.id}
            onPress={() => switchProfile(profile.id)}
          >
            {profile.label}
          </Stack.Toolbar.MenuAction>
        ))}
        <Stack.Toolbar.MenuAction
          icon="plus"
          onPress={() => router.push("/settings/servers/add")}
        >
          Add server…
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.Menu inline>
          {activeProfile ? (
            <Stack.Toolbar.MenuAction
              icon="archivebox"
              onPress={() => router.push(archivedThreadsHref())}
            >
              Archived threads
            </Stack.Toolbar.MenuAction>
          ) : null}
          <Stack.Toolbar.MenuAction
            icon="gearshape"
            onPress={() => router.push("/settings")}
          >
            Settings
          </Stack.Toolbar.MenuAction>
          {e2eModeEnabled ? (
            <Stack.Toolbar.MenuAction
              icon="paintpalette"
              onPress={() => router.push("/dev/ui")}
            >
              UI gallery
            </Stack.Toolbar.MenuAction>
          ) : null}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

/**
 * Android: the home header's left button — the active server's initials
 * with a realtime dot — opening the workspace sheet: the server switcher,
 * archived threads, and Settings.
 */
export function WorkspaceMenuButton() {
  const router = useRouter();
  const { tokens } = useTheme();
  const { profiles, activeProfile } = useProfiles();
  const realtimeState = useRealtimeConnectionState();
  const switchProfile = useSwitchProfile();
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
        onPress={sheet.present}
        className="h-10 w-10 items-center justify-center rounded-full active:bg-state-hover"
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
          <Text
            variant="title"
            numberOfLines={1}
            testID="workspace-profile-label"
          >
            {activeProfile?.label ?? "bb"}
          </Text>
          <Text variant="chrome">
            {activeProfile
              ? REALTIME_LABEL[realtimeState]
              : "No server selected"}
          </Text>
        </View>
        <Separator />
        {profiles.map((profile) => (
          <ListRow
            key={profile.id}
            title={profile.label}
            subtitle={profile.mode === "connect" ? "bb connect" : "Direct"}
            leading={profile.mode === "connect" ? "Globe" : "Laptop"}
            selected={profile.id === activeProfile?.id}
            onPress={() => {
              sheet.dismiss();
              switchProfile(profile.id);
            }}
            testID={`workspace-server-${profile.id}`}
          />
        ))}
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

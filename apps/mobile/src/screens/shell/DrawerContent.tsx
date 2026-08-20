import type { DrawerContentComponentProps } from "expo-router/drawer";
import { usePathname, useRouter, type Href } from "expo-router";
import { useCallback } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useProfiles,
  useRealtimeConnectionState,
  e2eModeEnabled,
} from "@/app-shell";
import type { MobileRealtimeConnectionState } from "@/lib/realtime";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Icon,
  ListRow,
  Separator,
  Text,
  toast,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import {
  SidebarActionsProvider,
  SidebarThreadList,
  useSidebarActions,
} from "../sidebar";
import { threadSearchHref } from "./hrefs";

const REALTIME_LABEL: Record<MobileRealtimeConnectionState, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
};

/** Thread id from the current route (`/threads/<id>`), for the selected row. */
export function selectedThreadIdFromPathname(pathname: string): string | null {
  const match = /^\/threads\/([^/]+)$/.exec(pathname);
  if (!match || match[1] === "search") return null;
  return decodeURIComponent(match[1]);
}

function DrawerNavRows({ onNavigate }: { onNavigate: (href: Href) => void }) {
  const actions = useSidebarActions();
  return (
    <>
      <ListRow
        title="New thread"
        leading="MessageSquarePlus"
        onPress={() => actions.createThread()}
        testID="drawer-new-thread"
      />
      <ListRow
        title="Search"
        leading="Search"
        onPress={() => onNavigate(threadSearchHref())}
        testID="drawer-search"
      />
    </>
  );
}

function DrawerFooter({ onNavigate }: { onNavigate: (href: Href) => void }) {
  const { tokens } = useTheme();
  const actions = useSidebarActions();
  return (
    <View className="flex-row items-center">
      <View className="flex-1">
        <ListRow
          title="Settings"
          leading="Settings"
          onPress={() => onNavigate("/settings")}
          testID="drawer-settings"
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sidebar display options"
        hitSlop={8}
        onPress={actions.openDisplayOptions}
        className="mr-2 h-10 w-10 items-center justify-center rounded-md active:bg-state-hover"
        testID="drawer-display-options"
      >
        <Icon name="SlidersHorizontal" size={20} color={tokens.foreground} />
      </Pressable>
    </View>
  );
}

/**
 * Left drawer = the bb sidebar: server switcher in the header, New thread /
 * Search rows, the grouped thread list, Settings + display options in the
 * footer. Every navigation closes the drawer first.
 */
export function DrawerContent({ navigation }: DrawerContentComponentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const { profiles, activeProfile, setActiveProfile, connection } =
    useProfiles();
  const realtimeState = useRealtimeConnectionState();
  const serverSheet = useSheet();

  const closeDrawer = useCallback(() => navigation.closeDrawer(), [navigation]);
  const go = useCallback(
    (href: Href) => {
      navigation.closeDrawer();
      router.push(href);
    },
    [navigation, router],
  );

  const dotColor =
    realtimeState === "connected"
      ? tokens.success
      : realtimeState === "reconnecting"
        ? tokens.warningText
        : tokens.mutedForeground;

  const selectedThreadId = selectedThreadIdFromPathname(pathname);

  const serverActions: ActionSheetAction[] = [
    ...profiles.map(
      (profile): ActionSheetAction => ({
        key: `profile-${profile.id}`,
        label:
          profile.id === activeProfile?.id
            ? `${profile.label} (active)`
            : profile.label,
        icon: profile.mode === "connect" ? "Globe" : "Laptop",
        onPress: () => {
          if (profile.id === activeProfile?.id) return;
          navigation.closeDrawer();
          setActiveProfile(profile.id).catch((error: unknown) => {
            toast.error("Could not switch server", {
              description: String(error),
            });
          });
        },
      }),
    ),
    {
      key: "add-server",
      label: "Add server",
      icon: "Plus",
      onPress: () => go("/settings/servers/add"),
    },
    ...(e2eModeEnabled
      ? [
          {
            key: "ui-gallery",
            label: "UI gallery",
            icon: "Palette" as const,
            onPress: () => go("/dev/ui"),
          },
        ]
      : []),
  ];

  return (
    <View
      className="flex-1 bg-sidebar"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Switch server"
        onPress={serverSheet.present}
        className="flex-row items-center gap-2 px-4 pb-3 pt-2 active:bg-state-hover"
        testID="drawer-server-switcher"
      >
        <View className="min-w-0 flex-1">
          <Text variant="title" numberOfLines={1} testID="drawer-profile-label">
            {activeProfile?.label ?? "bb"}
          </Text>
          {activeProfile ? (
            <View className="flex-row items-center gap-1.5">
              <View
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: dotColor }}
              />
              <Text variant="chrome" numberOfLines={1}>
                {REALTIME_LABEL[realtimeState]}
              </Text>
            </View>
          ) : (
            <Text variant="chrome">No server selected</Text>
          )}
        </View>
        <Icon name="ChevronDown" size={18} color={tokens.subtleForeground} />
      </Pressable>
      <Separator />
      {connection ? (
        <SidebarActionsProvider onBeforeNavigate={closeDrawer}>
          <DrawerNavRows onNavigate={go} />
          <View className="flex-1">
            <SidebarThreadList
              selectedThreadId={selectedThreadId}
              contentContainerStyle={{ paddingBottom: 16 }}
              testID="drawer-thread-list"
            />
          </View>
          <Separator />
          <DrawerFooter onNavigate={go} />
        </SidebarActionsProvider>
      ) : (
        <View className="flex-1">
          <ListRow
            title="Add server"
            leading="Plus"
            onPress={() => go("/settings/servers/add")}
            testID="drawer-add-server"
          />
          <View className="flex-1" />
          <Separator />
          <ListRow
            title="Settings"
            leading="Settings"
            onPress={() => go("/settings")}
            testID="drawer-settings"
          />
        </View>
      )}

      <ActionSheet
        controller={serverSheet}
        title="Servers"
        actions={serverActions}
      />
    </View>
  );
}

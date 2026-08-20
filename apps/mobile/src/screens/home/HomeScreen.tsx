import { Redirect, useNavigation, useRouter } from "expo-router";
import { useLayoutEffect } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProfiles } from "@/app-shell";
import { useTheme } from "@/theme";
import { Button, EmptyStatePanel, Icon, Spinner, Text } from "@/ui";
import { threadSearchHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";
import {
  SidebarActionsProvider,
  SidebarThreadList,
  useSidebarActions,
} from "../sidebar";

/** Search + display-options buttons in the drawer header (set from inside the provider). */
function HomeHeaderActions() {
  const navigation = useNavigation();
  const router = useRouter();
  const { tokens } = useTheme();
  const actions = useSidebarActions();
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View className="flex-row items-center gap-1 pr-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search threads"
            hitSlop={8}
            onPress={() => router.push(threadSearchHref())}
            className="h-10 w-10 items-center justify-center rounded-md active:bg-state-hover"
            testID="home-search"
          >
            <Icon name="Search" size={20} color={tokens.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sidebar display options"
            hitSlop={8}
            onPress={actions.openDisplayOptions}
            className="h-10 w-10 items-center justify-center rounded-md active:bg-state-hover"
            testID="home-display-options"
          >
            <Icon
              name="SlidersHorizontal"
              size={20}
              color={tokens.foreground}
            />
          </Pressable>
        </View>
      ),
    });
  }, [actions, navigation, router, tokens.foreground]);
  return null;
}

function NewThreadFab() {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  const actions = useSidebarActions();
  return (
    <View
      pointerEvents="box-none"
      className="absolute right-4"
      style={{ bottom: insets.bottom + 16 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New thread"
        onPress={() => actions.createThread()}
        className="h-14 w-14 items-center justify-center rounded-full bg-foreground active:bg-foreground/90"
        style={{
          shadowColor: tokens.ink,
          shadowOpacity: 0.25,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
        testID="home-new-thread"
      >
        <Icon name="MessageSquarePlus" size={24} color={tokens.background} />
      </Pressable>
    </View>
  );
}

/**
 * Home: the thread list for the active server (the same grouped list the
 * drawer shows, full width), pull-to-refresh, a New-thread FAB, and search /
 * display options in the header. With no saved server it hands off to the
 * add-server flow (first run).
 */
export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { status, profiles, activeProfile, connection } = useProfiles();
  const router = useRouter();

  if (status !== "ready") {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner />
      </View>
    );
  }
  if (profiles.length === 0) {
    return <Redirect href="/settings/servers/add" />;
  }

  if (activeProfile && !connection) {
    // The connector activates the profile right after the store is ready.
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner />
      </View>
    );
  }

  if (!connection || !activeProfile) {
    return (
      <Screen testID="home-screen">
        <EmptyStatePanel>
          <Text className="text-center text-sm text-muted-foreground">
            Pick a server from the drawer to see its threads.
          </Text>
        </EmptyStatePanel>
        <Button
          variant="outline"
          icon="Laptop"
          onPress={() => router.push("/settings/servers")}
        >
          Servers
        </Button>
      </Screen>
    );
  }

  return (
    <Screen scroll={false} testID="home-screen">
      <SidebarActionsProvider>
        <HomeHeaderActions />
        <SidebarThreadList
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          testID="home-thread-list"
        />
        <NewThreadFab />
      </SidebarActionsProvider>
    </Screen>
  );
}

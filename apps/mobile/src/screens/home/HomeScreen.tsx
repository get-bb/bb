import {
  Redirect,
  Stack,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from "expo-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProfiles } from "@/app-shell";
import type { ComposerHandle } from "@/composer";
import { useSidebarPreferences } from "@/data/sidebar";
import { haptic } from "@/lib/haptics";
import { withAlpha } from "@/markdown/colors";
import { scrimBaseColor, useTheme } from "@/theme";
import {
  Button,
  EmptyStatePanel,
  Icon,
  COMPOSER_KEYBOARD_GAP,
  KeyboardPaddingView,
  OverlayBounds,
  sfSymbolFor,
  Spinner,
  Text,
  useLiquidGlass,
} from "@/ui";
import { ComposeDock } from "../compose/ComposeDock";
import {
  useComposeController,
  type ComposeParams,
} from "../compose/useComposeController";
import { ConnectionBanner } from "../shell/ConnectionBanner";
import { threadHref, threadSearchHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";
import { ScreenTitle } from "../shell/ScreenTitle";
import { WorkspaceMenuButton, WorkspaceToolbar } from "../shell/WorkspaceMenu";
import {
  ORGANIZE_OPTIONS,
  SidebarActionsProvider,
  SidebarThreadList,
  SORT_OPTIONS,
  useSidebarActions,
} from "../sidebar";
import { ThreadSearchResults } from "../threads/ThreadSearchResults";

const IS_IOS = process.env.EXPO_OS === "ios";

const SCRIM_DURATION_MS = 180;
/** Opacity of the scrim over the list while the dock is expanded. */
const SCRIM_ALPHA = 0.35;
/** Gap between the last row and the dock (in flow, or floating over it). */
const LIST_BOTTOM_GAP = 16;
/** Liquid Glass: the dock host floats at the bottom of the overlay bounds. */
const FLOATING_DOCK_STYLE: ViewStyle = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
};

/** Android: the workspace avatar button on the header's left. */
function HomeWorkspaceButton() {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => <WorkspaceMenuButton />,
    });
  }, [navigation]);
  return null;
}

/**
 * Home header: the server label as the (large) title and the workspace menu
 * — server switcher / archived / Settings — on the left, a native pull-down
 * on iOS and the avatar button's sheet on Android. Rendered in every ready
 * state so the menu is reachable before a server connects.
 */
function HomeHeaderShell() {
  const { activeProfile } = useProfiles();
  return (
    <>
      <ScreenTitle large>{activeProfile?.label ?? "bb"}</ScreenTitle>
      {IS_IOS ? <WorkspaceToolbar /> : <HomeWorkspaceButton />}
    </>
  );
}

/**
 * iOS: the display-options pull-down on the header's right — organize and
 * sort as checked groups, then the section commands. Preferences apply as
 * soon as an item is picked.
 */
function HomeDisplayOptionsToolbar() {
  const actions = useSidebarActions();
  const [preferences, preferenceActions] = useSidebarPreferences();
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu
        icon="line.3.horizontal.decrease.circle"
        accessibilityLabel="Display options"
      >
        <Stack.Toolbar.Menu inline title="Organize">
          {ORGANIZE_OPTIONS.map((option) => (
            <Stack.Toolbar.MenuAction
              key={option.mode}
              icon={sfSymbolFor(option.icon)}
              isOn={preferences.organize === option.mode}
              onPress={() => {
                haptic("selection");
                preferenceActions.setOrganize(option.mode);
              }}
            >
              {option.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Menu inline title="Sort by">
          {SORT_OPTIONS.map((option) => (
            <Stack.Toolbar.MenuAction
              key={option.sort}
              icon={sfSymbolFor(option.icon)}
              isOn={preferences.sort === option.sort}
              onPress={() => {
                haptic("selection");
                preferenceActions.setSort(option.sort);
              }}
            >
              {option.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.MenuAction
          icon="text.badge.plus"
          onPress={() => actions.openSectionCreate(null)}
        >
          New section…
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction
          icon="arrow.up.arrow.down"
          onPress={actions.openSectionReorder}
        >
          Reorder sections…
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

/**
 * Android: search + display-options buttons in the home header (set from
 * inside the provider; iOS has the header search bar and the native menu).
 */
function HomeHeaderActionsAndroid() {
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
            className="h-10 w-10 items-center justify-center rounded-full active:bg-state-hover"
            testID="home-search"
          >
            <Icon name="Search" size={20} color={tokens.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sidebar display options"
            hitSlop={8}
            onPress={actions.openDisplayOptions}
            className="h-10 w-10 items-center justify-center rounded-full active:bg-state-hover"
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

/** `/?newThread=1`: open the dock without other params (`bb://compose`). */
const NEW_THREAD_FLAG = "newThread";

type NewThreadRouteParams = Record<
  keyof ComposeParams | typeof NEW_THREAD_FLAG,
  string | string[]
>;

const NEW_THREAD_PARAM_KEYS = [
  "projectId",
  "sectionId",
  "initialPrompt",
  "reuseEnvironmentId",
  "forkSourceThreadId",
  "forkSourceSeqEnd",
  "forkSourceThreadTitle",
  "handoffSourceThreadId",
  "handoffSourceThreadTitle",
] as const satisfies readonly (keyof ComposeParams)[];

function firstParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * `/?projectId=&sectionId=&initialPrompt=&reuseEnvironmentId=…` (see
 * `newThreadHref`): a project's "+", a deep link, or a fork / handoff seed
 * land on home with the dock open on these params.
 */
function useNewThreadRouteParams(): {
  params: ComposeParams;
  /** Changes whenever a new request arrives (the dock opens on it). */
  requestKey: string | null;
  clear: () => void;
} {
  const router = useRouter();
  const raw = useLocalSearchParams<Partial<NewThreadRouteParams>>();
  const params = useMemo((): ComposeParams => {
    const next: ComposeParams = {};
    for (const key of NEW_THREAD_PARAM_KEYS) {
      const value = firstParam(raw[key]);
      if (value !== undefined) next[key] = value;
    }
    return next;
  }, [raw]);
  const flagged = firstParam(raw[NEW_THREAD_FLAG]) !== undefined;
  const requestKey = useMemo(() => {
    const entries = NEW_THREAD_PARAM_KEYS.filter(
      (key) => params[key] !== undefined,
    ).map((key) => `${key}=${params[key] ?? ""}`);
    if (flagged) entries.unshift(NEW_THREAD_FLAG);
    return entries.length > 0 ? entries.join("&") : null;
  }, [flagged, params]);
  const clear = useCallback(() => {
    if (requestKey === null) return;
    router.setParams(
      Object.fromEntries(
        [...NEW_THREAD_PARAM_KEYS, NEW_THREAD_FLAG].map((key) => [
          key,
          undefined,
        ]),
      ),
    );
  }, [requestKey, router]);
  return { params, requestKey, clear };
}

/**
 * The home body: the thread list with the new-thread dock pinned under it.
 * The dock is the collapsed "Plan, ask, build…" pill; focusing it (or a
 * project's "+", or a routed new-thread request) expands it in place over a
 * scrim that dims the list, with the where-it-runs pickers on top and the
 * agent pickers below the prompt. Creating a thread collapses the dock and
 * opens the thread. On iOS the header search bar searches in place: while
 * it is open the list shows recent threads, then results, and the dock
 * steps aside.
 */
function HomeBody() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tokens, mode } = useTheme();
  const route = useNewThreadRouteParams();
  const controller = useComposeController(route.params);
  const composerRef = useRef<ComposerHandle | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [scrim] = useState(() => new Animated.Value(0));
  const [scrimMounted, setScrimMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = IS_IOS && (searchOpen || query.trim().length > 0);

  // Liquid Glass (iOS 26): the dock floats over the list as a glass pill
  // and the rows scroll under it. The host reports its height; the rows pad
  // for the part of it above the list's bottom edge (the home-indicator
  // padding sits below that edge).
  const glass = useLiquidGlass();
  const dockBottomPadding = Math.max(insets.bottom, 8);
  const [dockHeight, setDockHeight] = useState(0);
  const handleDockLayout = useCallback((event: LayoutChangeEvent) => {
    setDockHeight(event.nativeEvent.layout.height);
  }, []);
  const floatingDock = glass && !searching;
  const dockOverlap = floatingDock
    ? Math.max(0, dockHeight - dockBottomPadding)
    : 0;
  const listBottomPadding = dockOverlap + LIST_BOTTOM_GAP;

  const animateScrim = useCallback(
    (open: boolean) => {
      if (open) setScrimMounted(true);
      Animated.timing(scrim, {
        toValue: open ? 1 : 0,
        duration: SCRIM_DURATION_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !open) setScrimMounted(false);
      });
    },
    [scrim],
  );
  const setDockExpanded = useCallback(
    (next: boolean) => {
      setExpanded((current) => {
        if (current !== next) animateScrim(next);
        return next;
      });
    },
    [animateScrim],
  );
  // A routed request (a project's "+" in the list, a deep link, a fork /
  // handoff seed) opens the dock; the params stay on the route until the
  // thread is created — or the dock is dismissed, which drops the request
  // (a fork hint would otherwise pin the card open).
  const clearRoute = route.clear;
  const collapse = useCallback(() => {
    Keyboard.dismiss();
    composerRef.current?.blur();
    clearRoute();
  }, [clearRoute]);

  const requestKey = route.requestKey;
  useEffect(() => {
    if (requestKey === null) return;
    composerRef.current?.focus();
  }, [requestKey]);

  const createThreadInDock = useCallback(
    (target: { projectId?: string; sectionId?: string } | undefined) => {
      // Same as a routed request, without leaving the screen.
      router.setParams({
        [NEW_THREAD_FLAG]: "1",
        projectId: target?.projectId,
        sectionId: target?.sectionId,
      });
      composerRef.current?.focus();
      return true;
    },
    [router],
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
  }, []);

  // The banner scrolls with the rows, right under the large title.
  const banner = <ConnectionBanner inset />;

  return (
    <SidebarActionsProvider onCreateThread={createThreadInDock}>
      <HomeHeaderShell />
      {IS_IOS ? (
        <>
          <HomeDisplayOptionsToolbar />
          <Stack.SearchBar
            placeholder="Search threads"
            autoCapitalize="none"
            placement="stacked"
            hideWhenScrolling
            obscureBackground={false}
            barTintColor={tokens.secondary}
            textColor={tokens.foreground}
            tintColor={tokens.primary}
            onChangeText={(event) => setQuery(event.nativeEvent.text)}
            onOpen={() => setSearchOpen(true)}
            onFocus={() => setSearchOpen(true)}
            onClose={closeSearch}
            onCancelButtonPress={closeSearch}
          />
        </>
      ) : (
        <HomeHeaderActionsAndroid />
      )}
      <KeyboardPaddingView
        style={{ flex: 1 }}
        keyboardGap={COMPOSER_KEYBOARD_GAP}
      >
        {/* The dock's typeahead floats up to the top of this region, never
            under the header. */}
        <OverlayBounds style={{ flex: 1 }}>
          {/* Floating dock: the list's frame ends at the pill's bottom edge
              (the home-indicator inset stays outside it), so the scroll
              view's own safe-area inset stays zero and the content padding
              below is exact — RN's `scrollToEnd` ignores that inset. */}
          <View
            className="flex-1"
            style={
              floatingDock ? { paddingBottom: dockBottomPadding } : undefined
            }
          >
            {searching ? (
              <ThreadSearchResults
                query={query}
                ListHeaderComponent={banner}
                contentContainerStyle={{ paddingBottom: listBottomPadding }}
              />
            ) : (
              <SidebarThreadList
                ListHeaderComponent={banner}
                contentContainerStyle={{ paddingBottom: listBottomPadding }}
                scrollIndicatorInsets={
                  floatingDock ? { bottom: dockOverlap } : undefined
                }
                testID="home-thread-list"
              />
            )}
          </View>
          {/* The scrim dims everything under the card — the list and the
              dock's own margins — so the expanded card floats over it (and
              shows through the header's material). It overhangs the bounds
              by the keyboard gap: on devices without a home-indicator inset
              the bounds end that far above the keyboard, and the strip
              would otherwise show undimmed. */}
          {scrimMounted ? (
            <Animated.View
              pointerEvents={expanded ? "auto" : "none"}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: -COMPOSER_KEYBOARD_GAP,
                opacity: scrim,
                backgroundColor: withAlpha(
                  scrimBaseColor(mode, tokens),
                  SCRIM_ALPHA,
                ),
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close composer"
                onPress={collapse}
                style={{ flex: 1 }}
                testID="home-compose-scrim"
              />
            </Animated.View>
          ) : null}
          {/* The dock host: a hairline above the collapsed pill on the page
              background; while the card is expanded the scrim owns the
              region and the rule disappears. With Liquid Glass the host is
              a transparent overlay at the bottom of the bounds instead —
              the glass pill floats over the rows, and the host's own
              margins pass touches through (to the rows, or to the scrim
              while expanded). Hidden (kept mounted) while the header
              search bar is open. */}
          <View
            className="px-3 pt-2"
            pointerEvents={glass ? "box-none" : undefined}
            style={[
              {
                display: searching ? "none" : "flex",
                paddingBottom: dockBottomPadding,
              },
              glass
                ? FLOATING_DOCK_STYLE
                : {
                    borderTopWidth: expanded ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: tokens.borderHairline,
                  },
            ]}
            onLayout={glass ? handleDockLayout : undefined}
            testID="home-compose-dock"
          >
            <ComposeDock
              controller={controller}
              onExpandedChange={setDockExpanded}
              composerRef={composerRef}
              onCreated={(thread) => {
                collapse();
                if (controller.navigateAfterCreate) {
                  router.push(threadHref(thread.id));
                }
              }}
            />
          </View>
        </OverlayBounds>
      </KeyboardPaddingView>
    </SidebarActionsProvider>
  );
}

/**
 * Home: the root screen. The grouped thread list for the active server
 * under a large title, pull-to-refresh, the new-thread dock at the bottom,
 * the workspace menu (servers / archived / Settings) on the header's left
 * and search / display options on its right. With no saved server it hands
 * off to the add-server flow (first run).
 */
export function HomeScreen() {
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
        <HomeHeaderShell />
        <EmptyStatePanel>
          <Text className="text-center text-sm text-muted-foreground">
            Pick a server to see its threads.
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
    <Screen scroll={false} banner={false} testID="home-screen">
      <HomeBody key={activeProfile.id} />
    </Screen>
  );
}

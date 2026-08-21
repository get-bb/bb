import {
  Redirect,
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
import { Animated, Keyboard, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProfiles } from "@/app-shell";
import type { ComposerHandle } from "@/composer";
import { blendOver, withAlpha } from "@/markdown/colors";
import { scrimBaseColor, useTheme } from "@/theme";
import {
  Button,
  EmptyStatePanel,
  Icon,
  COMPOSER_KEYBOARD_GAP,
  KeyboardPaddingView,
  OverlayBounds,
  Spinner,
  Text,
} from "@/ui";
import { ComposeDock } from "../compose/ComposeDock";
import {
  useComposeController,
  type ComposeParams,
} from "../compose/useComposeController";
import { threadHref, threadSearchHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";
import { WorkspaceMenuButton } from "../shell/WorkspaceMenu";
import {
  SidebarActionsProvider,
  SidebarThreadList,
  useSidebarActions,
} from "../sidebar";

const SCRIM_DURATION_MS = 180;
/** Opacity of the scrim over the list while the dock is expanded. */
const SCRIM_ALPHA = 0.35;

/**
 * Home header: the server label as the title, the workspace menu (server
 * switcher / archived / Settings) on the left. Rendered in every ready state
 * so the menu is reachable before a server connects.
 */
function HomeHeaderShell({ dimmed = false }: { dimmed?: boolean }) {
  const navigation = useNavigation();
  const { activeProfile } = useProfiles();
  useLayoutEffect(() => {
    navigation.setOptions({
      title: activeProfile?.label ?? "bb",
      headerLeft: () => <WorkspaceMenuButton dimmed={dimmed} />,
    });
  }, [activeProfile?.label, dimmed, navigation]);
  return null;
}

/**
 * Search + display-options buttons in the home header (set from inside the
 * provider). While the dock is expanded the header is painted the same gray
 * as the scrim (it is navigator chrome above the screen, so the scrim view
 * cannot cover it) and its controls are muted.
 */
function HomeHeaderActions({ dimmed }: { dimmed: boolean }) {
  const navigation = useNavigation();
  const router = useRouter();
  const { tokens, fonts, mode } = useTheme();
  const actions = useSidebarActions();
  const scrimColor = scrimBaseColor(mode, tokens);
  const background = dimmed
    ? blendOver(tokens.background, scrimColor, SCRIM_ALPHA)
    : tokens.background;
  const foreground = dimmed
    ? blendOver(tokens.foreground, scrimColor, SCRIM_ALPHA)
    : tokens.foreground;
  useLayoutEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: background },
      headerTintColor: foreground,
      headerTitleStyle: {
        fontFamily: fonts.sans.semibold,
        fontWeight: "600",
        color: foreground,
      },
      headerRight: () => (
        <View className="flex-row items-center gap-1 pr-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search threads"
            hitSlop={8}
            disabled={dimmed}
            onPress={() => router.push(threadSearchHref())}
            className="h-10 w-10 items-center justify-center rounded-full active:bg-state-hover"
            testID="home-search"
          >
            <Icon name="Search" size={20} color={foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sidebar display options"
            hitSlop={8}
            disabled={dimmed}
            onPress={actions.openDisplayOptions}
            className="h-10 w-10 items-center justify-center rounded-full active:bg-state-hover"
            testID="home-display-options"
          >
            <Icon name="SlidersHorizontal" size={20} color={foreground} />
          </Pressable>
        </View>
      ),
    });
  }, [actions, background, dimmed, fonts, foreground, navigation, router]);
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
 * opens the thread.
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

  return (
    <SidebarActionsProvider onCreateThread={createThreadInDock}>
      <HomeHeaderShell dimmed={expanded} />
      <HomeHeaderActions dimmed={expanded} />
      <KeyboardPaddingView
        style={{ flex: 1 }}
        keyboardGap={COMPOSER_KEYBOARD_GAP}
      >
        {/* The dock's typeahead floats up to the top of this region, never
            under the header. */}
        <OverlayBounds style={{ flex: 1 }}>
          <View className="flex-1">
            <SidebarThreadList
              contentContainerStyle={{ paddingBottom: 16 }}
              testID="home-thread-list"
            />
          </View>
          {/* The scrim dims everything under the card — the list and the
              dock's own margins — so the expanded card floats over it. It
              overhangs the bounds by the keyboard gap: on devices without a
              home-indicator inset the bounds end that far above the
              keyboard, and the strip would otherwise show undimmed. */}
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
          <View
            className="px-3 pt-1"
            style={{ paddingBottom: Math.max(insets.bottom, 8) }}
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
 * Home: the root screen. The grouped thread list for the active server,
 * pull-to-refresh, the new-thread dock at the bottom, the workspace menu
 * (servers / archived / Settings) on the header's left and search / display
 * options on its right. With no saved server it hands off to the add-server
 * flow (first run).
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
    <Screen scroll={false} testID="home-screen">
      <HomeBody key={activeProfile.id} />
    </Screen>
  );
}

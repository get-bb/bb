import {
  DarkTheme,
  DefaultTheme,
  type NativeStackNavigationOptions,
  Stack,
  ThemeProvider as NavigationThemeProvider,
} from "expo-router";
import { useMemo } from "react";
import { Platform } from "react-native";
import { useTheme } from "@/theme";
import { HeaderGlass } from "./HeaderGlass";
import { LIST_SCREEN_OPTIONS, MODAL_SCREEN_OPTIONS } from "./screen-options";

const IS_IOS = process.env.EXPO_OS === "ios";
/**
 * iOS 26 draws its own scroll-edge effect under transparent headers. We
 * want frosted bars instead: Liquid Glass behind inline bars, the classic
 * frosted blur behind large-title bars, and the system effect hidden so it
 * does not double them. Earlier iOS gets the classic chrome material bar.
 */
const IOS_MAJOR = IS_IOS ? Number.parseInt(String(Platform.Version), 10) : 0;
const IOS_SYSTEM_BAR = IOS_MAJOR >= 26;
const GLASS_HEADER = IS_IOS && IOS_SYSTEM_BAR;

const renderHeaderGlass = () => <HeaderGlass />;

/**
 * Root native stack: home (the thread list) at the bottom, thread /
 * settings / dev screens pushed on top. iOS gets the system chrome: a
 * translucent material bar the content scrolls under, large titles on list
 * screens, the tint on bar items, the system font. Android keeps an opaque
 * bar in the canvas color. Screens set their own titles, toolbars and
 * search bars with `Stack.Title` / `Stack.Toolbar` / `Stack.SearchBar`.
 */
export function RootNavigator() {
  const { tokens, mode } = useTheme();
  // The native stack reads react-navigation's theme, not ours: its `dark`
  // flag becomes the UINavigationBar's `overrideUserInterfaceStyle`, and
  // `colors` back the bar items. Without a provider the stack assumes light,
  // forces the bar to the light trait, and every adaptive material (and
  // UIKit's own bar content: back chevron, search field) renders in its
  // light flavor over a dark app. Derive it from the app theme so the bar
  // follows the in-app mode as well as the system scheme.
  const navigationTheme = useMemo(() => {
    const base = mode === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: tokens.primary,
        background: tokens.background,
        card: tokens.background,
        text: tokens.foreground,
        border: tokens.border,
        notification: tokens.destructive,
      },
    };
  }, [mode, tokens]);
  const headerSurface: NativeStackNavigationOptions = IS_IOS
    ? GLASS_HEADER
      ? {
          // Inline bars: a Liquid Glass sheet (the composer's material),
          // rendered by the stack as the header background behind a
          // transparent bar, so the timeline refracts through it.
          headerTransparent: true,
          headerBlurEffect: "none",
          headerBackground: renderHeaderGlass,
          headerLargeStyle: { backgroundColor: "transparent" },
          scrollEdgeEffects: { top: "hidden" },
        }
      : { headerTransparent: true, headerBlurEffect: "systemChromeMaterial" }
    : { headerStyle: { backgroundColor: tokens.background } };
  // Large-title bars: the stack debounces their height while the title
  // collapses, so a glass sheet would lag behind the bar. The classic
  // frosted blur backs the compact bar instead (transparent at rest, under
  // the large title). The blur adapts to the bar's trait, which the
  // navigation theme above keeps in sync with the app mode.
  const listScreen: NativeStackNavigationOptions = GLASS_HEADER
    ? {
        ...LIST_SCREEN_OPTIONS,
        headerBackground: undefined,
        headerBlurEffect: "regular",
      }
    : LIST_SCREEN_OPTIONS;
  // The stack renders the header background even for hidden headers.
  const hiddenHeader: NativeStackNavigationOptions = {
    headerShown: false,
    headerBackground: undefined,
  };
  // Opaque, inline bar with a hairline edge for the terminal: a WebView that
  // manages its own insets (`never`), so nothing scrolls under the bar.
  // Every platform.
  const opaqueHeader: NativeStackNavigationOptions = {
    headerTransparent: false,
    headerBackground: undefined,
    headerStyle: { backgroundColor: tokens.background },
    headerShadowVisible: true,
  };
  return (
    <NavigationThemeProvider value={navigationTheme}>
      <Stack
        screenOptions={{
          headerShown: true,
          ...headerSurface,
          headerShadowVisible: false,
          headerLargeTitleShadowVisible: false,
          headerTintColor: tokens.primary,
          headerTitleStyle: { fontWeight: "600", color: tokens.foreground },
          headerLargeTitleStyle: { color: tokens.foreground },
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: tokens.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "bb", ...listScreen }} />
        <Stack.Screen name="threads/[id]" options={{ title: "Thread" }} />
        <Stack.Screen name="threads/search" options={{ title: "Search" }} />
        <Stack.Screen name="threads/[id]/files" options={{ title: "Files" }} />
        <Stack.Screen
          name="threads/[id]/terminal/index"
          options={{ title: "Terminals" }}
        />
        <Stack.Screen
          name="threads/[id]/terminal/[terminalId]"
          options={{ title: "Terminal", orientation: "all", ...opaqueHeader }}
        />
        <Stack.Screen
          name="settings/index"
          options={{ title: "Settings", ...listScreen }}
        />
        <Stack.Screen
          name="settings/archived"
          options={{ title: "Archived threads", ...listScreen }}
        />
        <Stack.Screen
          name="settings/server"
          options={{ title: "Server status" }}
        />
        <Stack.Screen
          name="settings/servers/index"
          options={{ title: "Servers", ...listScreen }}
        />
        <Stack.Screen
          name="settings/servers/add"
          options={{ title: "Add server" }}
        />
        <Stack.Screen name="settings/general" options={{ title: "General" }} />
        <Stack.Screen
          name="settings/appearance"
          options={{ title: "Appearance" }}
        />
        <Stack.Screen
          name="settings/experiments"
          options={{ title: "Experiments" }}
        />
        <Stack.Screen
          name="settings/usage"
          options={{ title: "Usage limits", ...listScreen }}
        />
        <Stack.Screen
          name="settings/updates"
          options={{ title: "Updates", ...listScreen }}
        />
        <Stack.Screen
          name="settings/machines/index"
          options={{ title: "Machines", ...listScreen }}
        />
        <Stack.Screen
          name="settings/machines/[hostId]"
          options={{ title: "Machine" }}
        />
        <Stack.Screen
          name="settings/plugins/index"
          options={{ title: "Plugins", ...listScreen }}
        />
        <Stack.Screen
          name="settings/plugins/browse"
          options={{ title: "Browse plugins", ...listScreen }}
        />
        <Stack.Screen
          name="settings/plugins/[pluginId]/index"
          options={{ title: "Plugin" }}
        />
        <Stack.Screen
          name="settings/plugins/[pluginId]/logs"
          options={{ title: "Plugin logs" }}
        />
        <Stack.Screen
          name="settings/marketplaces"
          options={{ title: "Marketplaces", ...listScreen }}
        />
        <Stack.Screen
          name="settings/skills/index"
          options={{ title: "Skills", ...listScreen }}
        />
        <Stack.Screen
          name="settings/skills/[skillId]"
          options={{ title: "Skill" }}
        />
        <Stack.Screen
          name="settings/skills/registry/index"
          options={{ title: "Browse skills", ...listScreen }}
        />
        <Stack.Screen
          name="settings/skills/registry/[registrySkillId]"
          options={{ title: "Skill" }}
        />
        <Stack.Screen
          name="connect/index"
          options={{ title: "bb connect", ...MODAL_SCREEN_OPTIONS }}
        />
        <Stack.Screen name="dev/ui" options={{ title: "UI gallery" }} />
        <Stack.Screen
          name="dev/markdown"
          options={{ title: "Markdown showcase" }}
        />
        <Stack.Screen name="dev/diff" options={{ title: "Diff + terminal" }} />
        <Stack.Screen name="dev/work-rows" options={{ title: "Work rows" }} />
        <Stack.Screen name="dev/composer" options={{ title: "Composer" }} />
        <Stack.Screen name="dev/spike" options={{ title: "Runtime spike" }} />
        <Stack.Screen
          name="dev/connect-spike"
          options={{ title: "Connect spike" }}
        />
        <Stack.Screen name="e2e/reset" options={hiddenHeader} />
        <Stack.Screen
          name="projects/new"
          options={{ title: "New project", ...MODAL_SCREEN_OPTIONS }}
        />
        <Stack.Screen
          name="projects/[id]/settings"
          options={{ title: "Project settings" }}
        />
        <Stack.Screen
          name="projects/[id]/threads/[threadId]"
          options={hiddenHeader}
        />
      </Stack>
    </NavigationThemeProvider>
  );
}

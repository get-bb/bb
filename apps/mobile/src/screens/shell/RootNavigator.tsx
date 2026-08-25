import { Stack, type NativeStackNavigationOptions } from "expo-router";
import { Platform } from "react-native";
import { useTheme } from "@/theme";
import { LIST_SCREEN_OPTIONS, MODAL_SCREEN_OPTIONS } from "./screen-options";

const IS_IOS = process.env.EXPO_OS === "ios";
/**
 * iOS 26 draws its own glass bar (scroll-edge effect) over transparent
 * headers; asking for a blur material on top paints an opaque light block
 * behind large titles in dark mode. Earlier iOS needs the material to keep
 * content legible under the bar.
 */
const IOS_MAJOR = IS_IOS ? Number.parseInt(String(Platform.Version), 10) : 0;
const IOS_SYSTEM_BAR = IOS_MAJOR >= 26;

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
  const headerSurface: NativeStackNavigationOptions = IS_IOS
    ? IOS_SYSTEM_BAR
      ? {
          headerTransparent: true,
          // Frosted bar. The adaptive chrome material resolves to its light
          // flavor inside the bar regardless of the app's scheme on iOS 26,
          // so pick the flavor from the theme mode (which also honors an
          // in-app light/dark override).
          headerBlurEffect:
            mode === "dark"
              ? "systemChromeMaterialDark"
              : "systemChromeMaterialLight",
          // At rest the large-title area stays transparent; the material
          // only backs the compact bar once content scrolls under it.
          headerLargeStyle: { backgroundColor: "transparent" },
          // The material is the edge treatment; the system edge effect
          // would double it.
          scrollEdgeEffects: { top: "hidden" },
        }
      : { headerTransparent: true, headerBlurEffect: "systemChromeMaterial" }
    : { headerStyle: { backgroundColor: tokens.background } };
  // Opaque, inline bar with a hairline edge: the thread timeline (nothing
  // scrolls under the title/status line) and the terminal (a WebView that
  // manages its own insets, `never`). Every platform.
  const opaqueHeader: NativeStackNavigationOptions = {
    headerTransparent: false,
    headerStyle: { backgroundColor: tokens.background },
    headerShadowVisible: true,
  };
  return (
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
      <Stack.Screen
        name="index"
        options={{ title: "bb", ...LIST_SCREEN_OPTIONS }}
      />
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
        options={{ title: "Settings", ...LIST_SCREEN_OPTIONS }}
      />
      <Stack.Screen
        name="settings/archived"
        options={{ title: "Archived threads", ...LIST_SCREEN_OPTIONS }}
      />
      <Stack.Screen
        name="settings/server"
        options={{ title: "Server status" }}
      />
      <Stack.Screen
        name="settings/servers/index"
        options={{ title: "Servers", ...LIST_SCREEN_OPTIONS }}
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
        options={{ title: "Usage limits", ...LIST_SCREEN_OPTIONS }}
      />
      <Stack.Screen
        name="settings/updates"
        options={{ title: "Updates", ...LIST_SCREEN_OPTIONS }}
      />
      <Stack.Screen
        name="settings/machines/index"
        options={{ title: "Machines", ...LIST_SCREEN_OPTIONS }}
      />
      <Stack.Screen
        name="settings/machines/[hostId]"
        options={{ title: "Machine" }}
      />
      <Stack.Screen
        name="settings/plugins/index"
        options={{ title: "Plugins", ...LIST_SCREEN_OPTIONS }}
      />
      <Stack.Screen
        name="settings/plugins/browse"
        options={{ title: "Browse plugins", ...LIST_SCREEN_OPTIONS }}
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
        options={{ title: "Marketplaces", ...LIST_SCREEN_OPTIONS }}
      />
      <Stack.Screen
        name="settings/skills/index"
        options={{ title: "Skills", ...LIST_SCREEN_OPTIONS }}
      />
      <Stack.Screen
        name="settings/skills/[skillId]"
        options={{ title: "Skill" }}
      />
      <Stack.Screen
        name="settings/skills/registry/index"
        options={{ title: "Browse skills", ...LIST_SCREEN_OPTIONS }}
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
      <Stack.Screen name="e2e/reset" options={{ headerShown: false }} />
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
        options={{ headerShown: false }}
      />
    </Stack>
  );
}

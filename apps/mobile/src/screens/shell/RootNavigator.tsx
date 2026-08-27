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
 * Root native stack. The page owns every product surface, so the stack is only
 * what the shell keeps: the WebView itself, the device settings that can turn
 * it off, server profiles, and connect enrolment. The WebView routes hide the
 * header entirely — the page draws its own chrome edge to edge.
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
        <Stack.Screen name="index" options={hiddenHeader} />
        <Stack.Screen name="webview" options={hiddenHeader} />
        <Stack.Screen
          name="settings/device"
          options={{ title: "This device", ...listScreen }}
        />
        <Stack.Screen
          name="settings/appearance"
          options={{ title: "Appearance" }}
        />
        <Stack.Screen
          name="settings/servers/index"
          options={{ title: "Servers", ...listScreen }}
        />
        <Stack.Screen
          name="settings/servers/add"
          options={{ title: "Add server", ...MODAL_SCREEN_OPTIONS }}
        />
        <Stack.Screen
          name="connect/index"
          options={{ title: "bb connect", ...MODAL_SCREEN_OPTIONS }}
        />
        <Stack.Screen name="dev/webview-spike" options={hiddenHeader} />
        <Stack.Screen name="e2e/reset" options={hiddenHeader} />
      </Stack>
    </NavigationThemeProvider>
  );
}

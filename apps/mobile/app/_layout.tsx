import "../global.css";
import "../src/lib/polyfills";

import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  PaletteProvider,
  ProfilesProvider,
  ServerPaletteSync,
  ShareIntentHandler,
  ThreadOpenSignalHandler,
  useAppBoot,
} from "@/app-shell";
import { RootNavigator, RouteErrorBoundary } from "@/screens";
import { ThemeProvider } from "@/theme";
import { useAppFonts } from "@/theme/useAppFonts";
import { SheetProvider, Toaster } from "@/ui";

// Deep links into a pushed screen still get home underneath.
export const unstable_settings = { anchor: "index" };

export { RouteErrorBoundary as ErrorBoundary };

export default function RootLayout() {
  const fonts = useAppFonts();
  const boot = useAppBoot();
  const ready = fonts.ready && boot.ready;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <PaletteProvider>
            {(palette) => (
              <ThemeProvider palette={palette}>
                <ProfilesProvider>
                  <ServerPaletteSync />
                  <SheetProvider>
                    <RootNavigator />
                    <ThreadOpenSignalHandler />
                    <ShareIntentHandler />
                    <Toaster />
                  </SheetProvider>
                </ProfilesProvider>
              </ThemeProvider>
            )}
          </PaletteProvider>
          <StatusBar style="auto" />
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

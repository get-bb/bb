import * as SplashScreen from "expo-splash-screen";
import { usePathname } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Animated,
  Appearance,
  Image,
  Platform,
  StyleSheet,
} from "react-native";
import splashLogo from "../../assets/splash-logo.png";
import splashLogoDark from "../../assets/splash-logo-dark.png";

const LAUNCH_SPLASH_MAX_MS = 8000;
const LAUNCH_SPLASH_FADE_MS = 250;
const SPLASH_HOLDING_PATHS = new Set(["/", "/webview"]);

const LOGO_WIDTH = 112;
const LOGO_HEIGHT = (LOGO_WIDTH * 487) / 581;

const launchArt =
  Appearance.getColorScheme() === "dark"
    ? {
        background: Platform.OS === "android" ? "#151515" : "#000000",
        logo: splashLogoDark,
      }
    : { background: "#ffffff", logo: splashLogo };

let revealed = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function hideNativeSplash(): void {
  void SplashScreen.hideAsync().catch(() => undefined);
}

export function holdLaunchSplash(): void {
  void SplashScreen.preventAutoHideAsync().catch(() => undefined);
}

export function revealApp(): void {
  hideNativeSplash();
  if (revealed) return;
  revealed = true;
  for (const listener of listeners) listener();
}

export function useAppRevealed(): boolean {
  return useSyncExternalStore(subscribe, () => revealed);
}

export function LaunchSplash() {
  const pathname = usePathname();
  const holdsSplash = SPLASH_HOLDING_PATHS.has(pathname);
  const isRevealed = useAppRevealed();
  const [opacity] = useState(() => new Animated.Value(1));
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    if (!holdsSplash) revealApp();
  }, [holdsSplash]);

  useEffect(() => {
    const timer = setTimeout(revealApp, LAUNCH_SPLASH_MAX_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isRevealed) return;
    Animated.timing(opacity, {
      toValue: 0,
      duration: LAUNCH_SPLASH_FADE_MS,
      useNativeDriver: true,
    }).start(() => setFaded(true));
  }, [isRevealed, opacity]);

  if (faded) return null;

  return (
    <Animated.View
      pointerEvents={isRevealed ? "none" : "auto"}
      style={[
        StyleSheet.absoluteFill,
        styles.cover,
        { backgroundColor: launchArt.background, opacity },
      ]}
      testID="launch-splash"
    >
      <Image
        source={launchArt.logo}
        onLoadEnd={hideNativeSplash}
        resizeMode="contain"
        style={{
          width: LOGO_WIDTH,
          height: LOGO_HEIGHT,
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: { alignItems: "center", justifyContent: "center" },
});

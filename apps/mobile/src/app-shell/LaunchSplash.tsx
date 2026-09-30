import * as SplashScreen from "expo-splash-screen";
import { usePathname } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Animated,
  Appearance,
  Image,
  Platform,
  StyleSheet,
  type ImageSourcePropType,
} from "react-native";
import androidLogo from "../../assets/android-splash-logo.png";
import androidLogoDark from "../../assets/android-splash-logo-dark.png";
import iosLogo from "../../assets/splash-icon.png";
import iosLogoDark from "../../assets/splash-icon-dark.png";

const LAUNCH_SPLASH_MAX_MS = 8000;
const LAUNCH_SPLASH_FADE_MS = 250;
const SPLASH_HOLDING_PATHS = new Set(["/", "/webview"]);

interface LaunchSplashArt {
  background: string;
  logo: ImageSourcePropType;
}

const LAUNCH_SPLASH = Platform.select({
  android: {
    logoWidth: 112,
    logoHeight: (112 * 487) / 581,
    light: { background: "#ffffff", logo: androidLogo },
    dark: { background: "#151515", logo: androidLogoDark },
  },
  default: {
    logoWidth: 200,
    logoHeight: 200,
    light: { background: "#ffffff", logo: iosLogo },
    dark: { background: "#000000", logo: iosLogoDark },
  },
});

const launchArt: LaunchSplashArt =
  Appearance.getColorScheme() === "dark"
    ? LAUNCH_SPLASH.dark
    : LAUNCH_SPLASH.light;

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

export function LaunchSplash() {
  const pathname = usePathname();
  const holdsSplash = SPLASH_HOLDING_PATHS.has(pathname);
  const isRevealed = useSyncExternalStore(subscribe, () => revealed);
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
          width: LAUNCH_SPLASH.logoWidth,
          height: LAUNCH_SPLASH.logoHeight,
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: { alignItems: "center", justifyContent: "center" },
});

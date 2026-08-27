import {
  MOBILE_BRIDGE_VERSION,
  buildBridgeInjectionScript,
  type NativeShellHandshake,
} from "@bb/mobile-bridge";
import Constants from "expo-constants";
import CookieManager from "@react-native-cookies/cookies";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useProfiles } from "@/app-shell";
import {
  buildShellUrl,
  isExternallyOpenable,
  isShellNavigation,
  resolveShellScreenState,
  shellPathFromUrl,
  shouldReloadForSession,
  subscribeToShellCommands,
  type ShellLoadPhase,
} from "@/lib/shell";
import { getShellPreferenceStore } from "@/lib/shell/shell-preference-store";
import { settingsSectionHref } from "@/screens/shell/hrefs";
import { Button, EmptyStatePanel, Spinner, Text } from "@/ui";
import { Linking } from "react-native";
import { useShellBridge } from "./useShellBridge";

/**
 * The WebView shell: one screen that renders the bb page for the active
 * profile. The shell keeps what a web page cannot do on a phone — profiles,
 * the Keychain credential, the session cookie, deep links, the share sheet,
 * haptics, the badge, and this error state — and the page owns the rest.
 */

const APP_VERSION = String(Constants.expoConfig?.version ?? "0.0.0");

/** A Direct profile has no auth, so its session never leaves this state. */
const IDLE_SESSION = { status: "idle" } as const;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function ProfileWebViewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ profileId?: string; path?: string }>();
  const { status, profiles, activeProfile, connection, setActiveProfile } =
    useProfiles();
  const preferences = getShellPreferenceStore();

  const requestedProfileId = firstParam(params.profileId);
  const requestedPath = firstParam(params.path);

  // A link may name a profile that is not the active one. Switch first; the
  // screen renders its loading state until the connector catches up.
  useEffect(() => {
    if (requestedProfileId === undefined) return;
    if (activeProfile?.id === requestedProfileId) return;
    if (!profiles.some((profile) => profile.id === requestedProfileId)) return;
    void setActiveProfile(requestedProfileId);
  }, [activeProfile?.id, profiles, requestedProfileId, setActiveProfile]);

  const profile = activeProfile;
  // A fresh object every render would re-run the reload effect every render.
  const session = connection?.session ?? IDLE_SESSION;
  const webViewRef = useRef<WebView>(null);
  const [load, setLoad] = useState<ShellLoadPhase>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const currentPathRef = useRef<string>("/");

  // The path the WebView opens on: the link's, else where the user was.
  const initialPath = useMemo(() => {
    if (requestedPath !== undefined && requestedPath.length > 0) {
      return requestedPath;
    }
    if (profile === null) return "/";
    return preferences.getLastPath(profile.id) ?? "/";
  }, [preferences, profile, requestedPath]);

  const sourceUrl = useMemo(
    () =>
      profile === null ? null : buildShellUrl(profile.serverUrl, initialPath),
    [initialPath, profile],
  );

  const rememberPath = useCallback(
    (path: string) => {
      currentPathRef.current = path;
      if (profile !== null) preferences.setLastPath(profile.id, path);
    },
    [preferences, profile],
  );

  const openDeviceSettings = useCallback(() => {
    router.push(settingsSectionHref("device"));
  }, [router]);

  const bridge = useShellBridge(webViewRef, {
    onReady: (path) => {
      setLoad({ kind: "ready" });
      rememberPath(path);
    },
    onPath: rememberPath,
    onOpenNative: (screen) => {
      if (screen === "device-settings") openDeviceSettings();
    },
  });

  // The device-settings screen is a sibling in the navigator, so its recovery
  // actions reach the live WebView through a small command bus.
  useEffect(
    () =>
      subscribeToShellCommands((command) => {
        if (command.kind === "clear-website-data") {
          webViewRef.current?.clearCache(true);
          void CookieManager.clearAll(false);
          void CookieManager.clearAll(true);
        }
        setLoad({ kind: "loading" });
        setReloadKey((value) => value + 1);
      }),
    [],
  );

  // Rotation and a keyboard both change the insets the page must pad with.
  const safeArea = useMemo(
    () => ({
      top: insets.top,
      right: insets.right,
      bottom: insets.bottom,
      left: insets.left,
    }),
    [insets.bottom, insets.left, insets.right, insets.top],
  );
  const hasSentHandshake = useRef(false);
  useEffect(() => {
    if (!hasSentHandshake.current) {
      hasSentHandshake.current = true;
      return;
    }
    bridge.send({ type: "safe-area", safeArea });
  }, [bridge, safeArea]);

  // WKWebView suspends JavaScript in the background, so the page has to be
  // told to reconnect rather than waiting for a timer that never fired.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") bridge.send({ type: "resume" });
    });
    return () => subscription.remove();
  }, [bridge]);

  // A resumed app re-mints the connect cookie. The page loaded with the old
  // one, so reload rather than let its next request meet the gate's sign-in.
  const previousSession = useRef(session);
  useEffect(() => {
    if (shouldReloadForSession(previousSession.current, session)) {
      setReloadKey((value) => value + 1);
      setLoad({ kind: "loading" });
    }
    previousSession.current = session;
  }, [session]);

  const handshake = useMemo<NativeShellHandshake | null>(() => {
    if (profile === null || sourceUrl === null) return null;
    return {
      bridgeVersion: MOBILE_BRIDGE_VERSION,
      appVersion: APP_VERSION,
      platform: Platform.OS === "android" ? "android" : "ios",
      profileMode: profile.mode,
      secureContext: sourceUrl.startsWith("https://"),
      safeArea,
      capabilities: [
        "haptic",
        "badge",
        "share",
        "open-external",
        "safe-area",
        "open-native",
      ],
    };
  }, [profile, safeArea, sourceUrl]);

  const retry = useCallback(() => {
    setLoad({ kind: "loading" });
    setReloadKey((value) => value + 1);
  }, []);

  const screen = resolveShellScreenState({
    storeReady: status === "ready",
    hasAnyProfile: profiles.length > 0,
    hasProfile: profile !== null && sourceUrl !== null,
    session,
    load,
  });

  if (screen.kind === "no-profile") {
    return <Redirect href="/settings/servers/add" />;
  }

  if (screen.kind === "loading") {
    return (
      <View
        className="flex-1 items-center justify-center gap-3"
        testID="shell-loading"
      >
        <Spinner />
        <Text className="text-sm text-muted-foreground">{screen.message}</Text>
      </View>
    );
  }

  if (screen.kind === "error") {
    return (
      <View className="flex-1 justify-center p-6" testID="shell-error">
        <EmptyStatePanel>
          <View className="items-center gap-3">
            <Text className="text-center text-base font-semibold">
              {screen.title}
            </Text>
            <Text className="text-center text-sm text-muted-foreground">
              {screen.detail}
            </Text>
            {screen.action === "retry" ? (
              <Button testID="shell-retry" onPress={retry}>
                Try again
              </Button>
            ) : null}
            {screen.action === "re-pair" ? (
              <Button
                testID="shell-repair"
                onPress={() =>
                  router.push(
                    profile === null
                      ? "/settings/servers"
                      : `/connect?profileId=${encodeURIComponent(profile.id)}`,
                  )
                }
              >
                Pair again
              </Button>
            ) : null}
            {/* The escape hatch. This screen is the one place the shell still
                renders when the page will not load, so it has to offer the way
                back to the switch that turns the shell off. */}
            <Button
              variant="ghost"
              testID="shell-device-settings"
              onPress={openDeviceSettings}
            >
              Device settings
            </Button>
          </View>
        </EmptyStatePanel>
      </View>
    );
  }

  if (profile === null || sourceUrl === null || handshake === null) return null;

  return (
    <View className="flex-1" testID="shell-webview">
      <WebView
        key={`${profile.id}#${sourceUrl}#${reloadKey}`}
        ref={webViewRef}
        source={{ uri: sourceUrl }}
        // Phase 0 measured every one of these. See the plan, section 11.
        sharedCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // Without "grant" WKWebView re-asks for the microphone on every
        // recording, which makes voice input unusable (11.1).
        mediaCapturePermissionGrantType="grant"
        // iOS draws a previous/next/done bar above the keyboard for every web
        // input. It costs 68 CSS px the composer needs (11.4).
        hideKeyboardAccessoryView
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        webviewDebuggingEnabled={__DEV__}
        injectedJavaScriptBeforeContentLoaded={buildBridgeInjectionScript(
          handshake,
        )}
        onMessage={bridge.onMessage}
        onShouldStartLoadWithRequest={(request) => {
          if (isShellNavigation(request.url, profile.serverUrl)) return true;
          // A link that leaves the server opens in the system browser. The
          // shell has no chrome to navigate back from a foreign site.
          if (isExternallyOpenable(request.url)) {
            void Linking.openURL(request.url).catch(() => undefined);
          }
          return false;
        }}
        onNavigationStateChange={(state) => {
          const path = shellPathFromUrl(state.url, profile.serverUrl);
          if (path !== null) rememberPath(path);
        }}
        onLoadEnd={() =>
          setLoad((previous) =>
            previous.kind === "loading" ? { kind: "ready" } : previous,
          )
        }
        onError={(event) =>
          setLoad({
            kind: "failed",
            detail: event.nativeEvent.description || "Unknown error",
          })
        }
        onHttpError={(event) => {
          // The gate answers an unauthenticated WebView with its own sign-in
          // page on 401. Showing that inside the shell reads as a broken app.
          const { statusCode } = event.nativeEvent;
          if (statusCode >= 400)
            setLoad({ kind: "http-error", status: statusCode });
        }}
        onContentProcessDidTerminate={retry}
      />
    </View>
  );
}

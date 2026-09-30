import {
  MOBILE_BRIDGE_VERSION,
  buildBridgeInjectionScript,
  type NativeShellHandshake,
} from "@bb/mobile-bridge";
import Constants from "expo-constants";
import CookieManager from "@react-native-cookies/cookies";
import {
  Redirect,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { AppState, BackHandler, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebViewKeyboardFrame } from "./WebViewKeyboardFrame";
import { WebView, type WebViewProps } from "react-native-webview";
import { revealApp, useProfiles } from "@/app-shell";
import { nativeSessionCache } from "@/lib/native";
import {
  buildShellUrl,
  isExternallyOpenable,
  isShellNavigation,
  resolveShellLoadPath,
  resolveShellScreenState,
  shellPathFromUrl,
  shouldReloadForSession,
  subscribeToShellCommands,
  type ShellLoadPhase,
} from "@/lib/shell";
import { firstParam, settingsSectionHref } from "@/screens/shell/hrefs";
import { useTheme } from "@/theme";
import { Button, EmptyStatePanel, Spinner, Text } from "@/ui";
import { Linking } from "react-native";
import { useShellBridge } from "./useShellBridge";

const APP_VERSION = String(Constants.expoConfig?.version ?? "0.0.0");

const IDLE_SESSION = { status: "idle" } as const;

export function ProfileWebViewScreen() {
  const { tokens } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ profileId?: string; path?: string }>();
  const { status, profiles, activeProfile, connection, setActiveProfile } =
    useProfiles();

  const requestedProfileId = firstParam(params.profileId);
  const requestedPath = firstParam(params.path);

  useEffect(() => {
    if (requestedProfileId === undefined) return;
    if (activeProfile?.id === requestedProfileId) return;
    if (!profiles.some((profile) => profile.id === requestedProfileId)) return;
    void setActiveProfile(requestedProfileId);
  }, [activeProfile?.id, profiles, requestedProfileId, setActiveProfile]);

  const profile = activeProfile;
  const session = connection?.session ?? IDLE_SESSION;
  const webViewRef = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [load, setLoad] = useState<ShellLoadPhase>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [visited, setVisited] = useState<{
    scope: string;
    path: string;
  } | null>(null);

  const loadScope =
    profile === null
      ? null
      : `${profile.id}#${profile.serverUrl}#${requestedPath ?? ""}`;

  useEffect(() => {
    canGoBack.current = false;
  }, [loadScope, reloadKey]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (!canGoBack.current || webViewRef.current === null) return false;
          webViewRef.current.goBack();
          return true;
        },
      );
      return () => subscription.remove();
    }, []),
  );

  const sourceUrl = useMemo(() => {
    if (profile === null) return null;
    const path = resolveShellLoadPath({
      visitedPath:
        visited !== null && visited.scope === loadScope ? visited.path : null,
      requestedPath,
    });
    return buildShellUrl(profile.serverUrl, path);
  }, [loadScope, profile, requestedPath, visited]);

  const rememberPath = useCallback(
    (path: string) => {
      if (loadScope === null) return;
      setVisited((previous) =>
        previous !== null &&
        previous.scope === loadScope &&
        previous.path === path
          ? previous
          : { scope: loadScope, path },
      );
    },
    [loadScope],
  );

  const openDeviceSettings = useCallback(() => {
    router.push(settingsSectionHref("device"));
  }, [router]);

  const bridge = useShellBridge(webViewRef, {
    onReady: (path) => {
      setLoad({ kind: "ready" });
      revealApp();
      rememberPath(path);
    },
    onPath: rememberPath,
    onOpenNative: (screen) => {
      if (screen === "device-settings") openDeviceSettings();
    },
  });

  const connectProfileId = profile?.mode === "connect" ? profile.id : null;
  useEffect(
    () =>
      subscribeToShellCommands((command) => {
        if (command.kind === "clear-website-data") {
          webViewRef.current?.clearCache(true);
          void CookieManager.clearAll(false);
          void CookieManager.clearAll(true);
          if (connectProfileId !== null) {
            void nativeSessionCache.clear(connectProfileId);
          }
        }
        setLoad({ kind: "loading" });
        setReloadKey((value) => value + 1);
      }),
    [connectProfileId],
  );

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

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") bridge.send({ type: "resume" });
    });
    return () => subscription.remove();
  }, [bridge]);

  const previousSession = useRef(session);
  useEffect(() => {
    if (shouldReloadForSession(previousSession.current, session, Date.now())) {
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
    requiresSession: profile?.mode === "connect",
    session,
    load,
  });

  const showsFailure =
    screen.kind === "error" ||
    (screen.kind === "webview" && screen.serverErrorStatus !== null);
  useEffect(() => {
    if (showsFailure) revealApp();
  }, [showsFailure]);

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

  if (
    profile === null ||
    loadScope === null ||
    sourceUrl === null ||
    handshake === null
  ) {
    return null;
  }

  return (
    <WebViewKeyboardFrame
      style={{ flex: 1, backgroundColor: tokens.background }}
      testID="shell-webview"
    >
      <ShellWebView
        key={`${loadScope}#${reloadKey}`}
        ref={webViewRef}
        initialUrl={sourceUrl}
        style={{ backgroundColor: tokens.background }}
        sharedCookiesEnabled
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        hideKeyboardAccessoryView
        allowsBackForwardNavigationGestures={false}
        bounces={false}
        pullToRefreshEnabled={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        webviewDebuggingEnabled={__DEV__}
        injectedJavaScriptBeforeContentLoaded={buildBridgeInjectionScript(
          handshake,
        )}
        onMessage={(event) => {
          canGoBack.current = event.nativeEvent.canGoBack;
          bridge.onMessage(event);
        }}
        onShouldStartLoadWithRequest={(request) => {
          if (isShellNavigation(request.url, profile.serverUrl)) return true;
          if (isExternallyOpenable(request.url)) {
            void Linking.openURL(request.url).catch(() => undefined);
          }
          return false;
        }}
        onNavigationStateChange={(state) => {
          canGoBack.current = state.canGoBack;
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
          const { statusCode } = event.nativeEvent;
          if (statusCode >= 400)
            setLoad({ kind: "http-error", status: statusCode });
        }}
        onContentProcessDidTerminate={retry}
        onRenderProcessGone={retry}
      />
      {screen.serverErrorStatus !== null ? (
        <View
          pointerEvents="box-none"
          className="absolute inset-x-0 bottom-0 items-center"
          style={{ paddingBottom: insets.bottom + 16 }}
          testID="shell-server-error"
        >
          <Button
            variant="outline"
            icon="Settings"
            testID="shell-server-error-device-settings"
            onPress={openDeviceSettings}
          >
            Device settings
          </Button>
        </View>
      ) : null}
    </WebViewKeyboardFrame>
  );
}

type ShellWebViewProps = Omit<WebViewProps, "source"> & {
  initialUrl: string;
  ref: Ref<WebView>;
};

function ShellWebView({ initialUrl, ref, ...props }: ShellWebViewProps) {
  const [source] = useState(() => ({ uri: initialUrl }));
  return <WebView {...props} ref={ref} source={source} />;
}

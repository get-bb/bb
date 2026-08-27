// Phase 0 spike screen for the "WebView shell around the PWA" plan.
//
// It loads any bb server origin in a WKWebView with the props the shell would
// use, then runs injected probes for the six Phase 0 questions: getUserMedia,
// the file chooser, xterm, the soft keyboard, cold-start timing, and a
// plain-HTTP LAN origin.
//
// Everything the page reports is appended to an on-screen log and mirrored to
// `<documents>/webview-spike/session.jsonl`, so a run on a simulator can be
// read from the host without a debugger attached.
import {
  fetchDesktopSession,
  redeemMachineCredential,
} from "@bb/connect-client";
import CookieManager from "@react-native-cookies/cookies";
import { File, Directory, Paths } from "expo-file-system";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { MediaCapturePermissionGrantType } from "react-native-webview/lib/WebViewTypes";
import {
  BOOT_TIMING_PROBE,
  SPIKE_HARNESS,
  SPIKE_PROBES,
  type SpikeProbeId,
} from "./webview-spike-probes";

// The boot watcher has to start at the page's time origin, so it ships with
// the harness rather than as a probe a run injects later.
const SPIKE_PRELUDE = `${SPIKE_HARNESS}
${BOOT_TIMING_PROBE}`;

const GRANT_TYPES: MediaCapturePermissionGrantType[] = [
  "prompt",
  "grant",
  "grantIfSameHostElsePrompt",
  "grantIfSameHostElseDeny",
  "deny",
];

interface SpikeEvent {
  atIso: string;
  source: "native" | "page";
  payload: unknown;
}

/**
 * Mirrors every spike event to two host-readable channels: the Metro console,
 * which a run can `grep` live, and a JSONL file inside the app container for a
 * complete record after the run.
 */
function appendSessionLine(event: SpikeEvent): void {
  const line = JSON.stringify(event);
  console.log(`SPIKE ${line}`);
  try {
    const directory = new Directory(Paths.document, "webview-spike");
    if (!directory.exists) directory.create({ intermediates: true });
    const file = new File(directory, "session.jsonl");
    if (!file.exists) file.create();
    const handle = file.open();
    try {
      handle.offset = file.size;
      handle.writeBytes(new TextEncoder().encode(`${line}\n`));
    } finally {
      handle.close();
    }
  } catch {
    // The log file is a convenience for the host. Never fail the run on it.
  }
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const APEX_URL = process.env.EXPO_PUBLIC_BB_CONNECT_APEX ?? "https://getbb.app";

export function WebViewSpikeScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    url?: string;
    grant?: string;
    chrome?: string;
    incognito?: string;
    cache?: string;
    code?: string;
    accessory?: string;
    appbound?: string;
    probes?: string;
    nonce?: string;
    delay?: string;
  }>();

  const initialUrl = firstParam(params.url) ?? "http://localhost:18524/";
  const [urlDraft, setUrlDraft] = useState(initialUrl);
  const [loadedUrl, setLoadedUrl] = useState(initialUrl);
  const [reloadKey, setReloadKey] = useState(0);
  const [grantType, setGrantType] = useState<MediaCapturePermissionGrantType>(
    (GRANT_TYPES.find((value) => value === firstParam(params.grant)) ??
      "grant") as MediaCapturePermissionGrantType,
  );
  const [showChrome, setShowChrome] = useState(
    firstParam(params.chrome) !== "0",
  );
  const [incognito, setIncognito] = useState(
    firstParam(params.incognito) === "1",
  );
  const [cacheEnabled, setCacheEnabled] = useState(
    firstParam(params.cache) !== "0",
  );
  // iOS puts a previous/next/Done accessory bar above the keyboard for every
  // web form field. The native app has no such bar, so the shell needs to know
  // whether hiding it closes part of the keyboard-quality gap.
  const [hideAccessoryBar, setHideAccessoryBar] = useState(
    firstParam(params.accessory) === "0",
  );
  // WKWebView only exposes `navigator.serviceWorker` for app-bound domains,
  // which need both this flag and a static `WKAppBoundDomains` Info.plist list.
  const appBound = firstParam(params.appbound) === "1";
  const [log, setLog] = useState<string[]>([]);
  const webViewRef = useRef<WebView>(null);
  const loadStartedAtRef = useRef<number | null>(null);

  const record = useCallback((source: "native" | "page", payload: unknown) => {
    const event: SpikeEvent = {
      atIso: new Date().toISOString(),
      source,
      payload,
    };
    appendSessionLine(event);
    const text =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    setLog((previous) =>
      [`${event.atIso.slice(11, 23)} ${source[0]} ${text}`, ...previous].slice(
        0,
        200,
      ),
    );
  }, []);

  useEffect(() => {
    record("native", {
      kind: "session",
      loadedUrl,
      grantType,
      incognito,
      cacheEnabled,
      reloadKey,
    });
  }, [cacheEnabled, grantType, incognito, loadedUrl, record, reloadKey]);

  // Enrolls this simulator as a connect machine and installs the desktop
  // session cookie in both native cookie stores, exactly the way
  // `dev/connect-spike` does. The WebView then authenticates through the same
  // jar, so a tunnel origin loads without a sign-in page.
  const enroll = useCallback(
    async (machineCode: string) => {
      try {
        const credential = await redeemMachineCredential({
          apexUrl: APEX_URL,
          code: machineCode.trim(),
        });
        record("native", {
          kind: "enroll",
          step: "redeem",
          handle: credential.handle,
          serverUrl: credential.serverUrl,
        });
        const { cookie } = await fetchDesktopSession(credential);
        const cookieSpec = {
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: "/",
          secure: true,
          httpOnly: true,
          expires: new Date(cookie.expiresAt).toISOString(),
        };
        await CookieManager.set(credential.serverUrl, cookieSpec, false);
        await CookieManager.set(credential.serverUrl, cookieSpec, true);
        record("native", {
          kind: "enroll",
          step: "cookie",
          domain: cookie.domain,
          expiresAt: cookie.expiresAt,
        });
        setUrlDraft(`${credential.serverUrl}/`);
        setLoadedUrl(`${credential.serverUrl}/`);
        setReloadKey((value) => value + 1);
      } catch (error) {
        record("native", {
          kind: "enroll",
          step: "failed",
          error: String(error),
        });
      }
    },
    [record],
  );

  const enrollCode = firstParam(params.code);
  useEffect(() => {
    if (enrollCode === undefined || enrollCode.length === 0) return;
    void enroll(enrollCode);
  }, [enroll, enrollCode]);

  // Expo Router reuses this screen when a new deep link only changes the
  // query, so the loaded URL has to follow the param rather than seed state.
  const urlParam = firstParam(params.url);
  const cacheParam = firstParam(params.cache);
  const accessoryParam = firstParam(params.accessory);
  useEffect(() => {
    if (urlParam !== undefined && urlParam.length > 0) {
      setUrlDraft(urlParam);
      setLoadedUrl((previous) => (previous === urlParam ? previous : urlParam));
    }
    if (cacheParam !== undefined) setCacheEnabled(cacheParam !== "0");
    if (accessoryParam !== undefined)
      setHideAccessoryBar(accessoryParam === "0");
  }, [accessoryParam, cacheParam, urlParam]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const raw = event.nativeEvent.data;
      try {
        record("page", JSON.parse(raw));
      } catch {
        record("page", raw);
      }
    },
    [record],
  );

  const runProbe = useCallback(
    (script: string, id: string) => {
      record("native", { kind: "probe", id });
      webViewRef.current?.injectJavaScript(script);
    },
    [record],
  );

  // `bb://dev/webview-spike?probes=environment,voice&nonce=1` runs a probe
  // sequence with no taps, so a whole spike is one `simctl openurl` call.
  const probeList = firstParam(params.probes);
  const probeNonce = firstParam(params.nonce);
  const probeDelayMs = Number(firstParam(params.delay) ?? "1200");
  useEffect(() => {
    if (probeList === undefined || probeList.length === 0) return;
    const ids = probeList.split(",").map((value) => value.trim());
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    ids.forEach((id, index) => {
      const probe = SPIKE_PROBES.find(
        (entry) => entry.id === (id as SpikeProbeId),
      );
      if (probe === undefined) {
        record("native", { kind: "probe", id, error: "unknown probe" });
        return;
      }
      timers.push(
        setTimeout(
          () => {
            if (!cancelled) runProbe(probe.script, probe.id);
          },
          probeDelayMs * (index + 1),
        ),
      );
    });
    return () => {
      cancelled = true;
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [probeDelayMs, probeList, probeNonce, record, runProbe]);

  const load = useCallback(() => {
    loadStartedAtRef.current = Date.now();
    setLoadedUrl(urlDraft.trim());
    setReloadKey((value) => value + 1);
  }, [urlDraft]);

  const probeButtons = useMemo(
    () =>
      SPIKE_PROBES.map((probe) => (
        <SpikeButton
          key={probe.id}
          label={probe.label}
          onPress={() => runProbe(probe.script, probe.id)}
        />
      )),
    [runProbe],
  );

  return (
    <View style={{ flex: 1, paddingTop: showChrome ? insets.top : 0 }}>
      {showChrome ? (
        <View style={{ padding: 8, gap: 6 }}>
          <TextInput
            testID="spike-url"
            value={urlDraft}
            onChangeText={setUrlDraft}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://host/"
            style={{
              borderWidth: 1,
              borderColor: "#999",
              borderRadius: 8,
              padding: 8,
              fontSize: 13,
            }}
          />
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <SpikeButton label="Load" onPress={load} testID="spike-load" />
            <SpikeButton
              label={`grant:${grantType}`}
              onPress={() =>
                setGrantType(
                  GRANT_TYPES[
                    (GRANT_TYPES.indexOf(grantType) + 1) % GRANT_TYPES.length
                  ] as MediaCapturePermissionGrantType,
                )
              }
            />
            <SpikeButton
              label={incognito ? "incognito:on" : "incognito:off"}
              onPress={() => setIncognito((value) => !value)}
            />
            <SpikeButton
              label={cacheEnabled ? "cache:on" : "cache:off"}
              onPress={() => setCacheEnabled((value) => !value)}
            />
            <SpikeButton
              label={hideAccessoryBar ? "accessory:off" : "accessory:on"}
              onPress={() => setHideAccessoryBar((value) => !value)}
            />
            <SpikeButton
              label="Hide chrome"
              onPress={() => setShowChrome(false)}
              testID="spike-hide-chrome"
            />
          </View>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {probeButtons}
          </View>
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        <WebView
          key={`${loadedUrl}#${reloadKey}#${incognito ? "i" : "p"}#${cacheEnabled ? "c" : "n"}#${hideAccessoryBar ? "a" : "b"}#${probeNonce ?? ""}#${appBound ? "ab" : "nb"}`}
          ref={webViewRef}
          source={{ uri: loadedUrl }}
          // The props the production shell would set.
          sharedCookiesEnabled
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType={grantType}
          allowsBackForwardNavigationGestures
          allowFileAccessFromFileURLs
          incognito={incognito}
          cacheEnabled={cacheEnabled}
          pullToRefreshEnabled
          hideKeyboardAccessoryView={hideAccessoryBar}
          limitsNavigationsToAppBoundDomains={appBound}
          webviewDebuggingEnabled
          injectedJavaScriptBeforeContentLoaded={SPIKE_PRELUDE}
          onMessage={onMessage}
          onLoadStart={(event) => {
            loadStartedAtRef.current ??= Date.now();
            record("native", {
              kind: "loadStart",
              url: event.nativeEvent.url,
            });
          }}
          onLoadEnd={(event) => {
            const startedAt = loadStartedAtRef.current;
            record("native", {
              kind: "loadEnd",
              url: event.nativeEvent.url,
              title: event.nativeEvent.title,
              elapsedMs: startedAt === null ? null : Date.now() - startedAt,
            });
          }}
          onHttpError={(event) =>
            record("native", {
              kind: "httpError",
              status: event.nativeEvent.statusCode,
              url: event.nativeEvent.url,
            })
          }
          onError={(event) =>
            record("native", {
              kind: "error",
              description: event.nativeEvent.description,
              code: event.nativeEvent.code,
            })
          }
          onContentProcessDidTerminate={() =>
            record("native", { kind: "contentProcessTerminated" })
          }
        />
      </View>

      {showChrome ? (
        <ScrollView style={{ maxHeight: 190, backgroundColor: "#111" }}>
          {log.map((line, index) => (
            <Text
              key={index}
              style={{ color: "#9f9", fontFamily: "Menlo", fontSize: 9 }}
            >
              {line}
            </Text>
          ))}
        </ScrollView>
      ) : (
        <Pressable
          onPress={() => setShowChrome(true)}
          style={{
            position: "absolute",
            top: insets.top,
            right: 4,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: "rgba(0,0,0,0.35)",
            alignItems: "center",
            justifyContent: "center",
          }}
          testID="spike-show-chrome"
        >
          <Text style={{ color: "white", fontSize: 14 }}>⋯</Text>
        </Pressable>
      )}
    </View>
  );
}

function SpikeButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const style = ({ pressed }: { pressed: boolean }): ViewStyle => ({
    backgroundColor: pressed ? "#1e3a8a" : "#2563eb",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  });
  return (
    <Pressable onPress={onPress} style={style} testID={testID}>
      <Text style={{ color: "white", fontWeight: "600", fontSize: 11 }}>
        {label}
      </Text>
    </Pressable>
  );
}

// Phase 0 connect spike screen. Not product UI.
//
// Flow under test (desktop-app model, no gate change):
//   machine code → redeemMachineCredential (apex)
//   → fetchDesktopSession (gate, machine header)
//   → install cookie in the native cookie stores (@react-native-cookies/cookies)
//   → verify fetch /api/v1/system/config, /ws upgrade, expo-image, WebView
//     all authenticate through https://<handle>.getbb.app.
import {
  fetchDesktopSession,
  redeemMachineCredential,
  type ConnectCredential,
} from "@bb/connect-client";
import CookieManager from "@react-native-cookies/cookies";
import { Image } from "expo-image";
import { Redirect } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { e2eModeEnabled } from "@/app-shell";

const APEX_URL = process.env.EXPO_PUBLIC_BB_CONNECT_APEX ?? "https://getbb.app";

function ConnectSpikeScreen() {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState("");
  const [credential, setCredential] = useState<ConnectCredential | null>(null);
  const [cookieValue, setCookieValue] = useState<string | null>(null);
  const [cookieHeader, setCookieHeader] = useState<string | null>(null);
  const [imageNonce, setImageNonce] = useState(0);
  const [imageStatusHeader, setImageStatusHeader] = useState("not loaded");
  const [showWebView, setShowWebView] = useState(false);
  const [imageStatus, setImageStatus] = useState("not loaded");
  const [log, setLog] = useState<string[]>([]);
  const append = (line: string) =>
    setLog((prev) =>
      [`${new Date().toISOString().slice(11, 19)} ${line}`, ...prev].slice(
        0,
        40,
      ),
    );

  const redeem = async () => {
    try {
      const cred = await redeemMachineCredential({
        apexUrl: APEX_URL,
        code: code.trim(),
      });
      setCredential(cred);
      append(`redeemed: handle=${cred.handle} serverUrl=${cred.serverUrl}`);
    } catch (error) {
      append(`redeem error: ${String(error)}`);
    }
  };

  const mintSession = async () => {
    if (!credential) return append("no credential");
    try {
      const session = await fetchDesktopSession(credential);
      const { cookie } = session;
      // Install in NSHTTPCookieStorage (fetch/WebSocket/expo-image) AND
      // WKHTTPCookieStore (WebView) on iOS; CookieManager on Android.
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
      setCookieValue(cookie.value.slice(0, 12) + "…");
      setCookieHeader(`${cookie.name}=${cookie.value}`);
      setImageNonce((n) => n + 1);
      const stored = await CookieManager.get(credential.serverUrl, false);
      append(
        `session cookie installed: ${Object.keys(stored).join(",")} exp=${new Date(cookie.expiresAt).toISOString()}`,
      );
    } catch (error) {
      append(`session error: ${String(error)}`);
    }
  };

  const testFetch = async () => {
    if (!credential) return append("no credential");
    try {
      const res = await fetch(`${credential.serverUrl}/api/v1/system/config`);
      const text = await res.text();
      append(
        `fetch /system/config → ${res.status} ${res.headers.get("content-type")} ${text.slice(0, 60)}`,
      );
    } catch (error) {
      append(`fetch error: ${String(error)}`);
    }
  };

  const testWebSocket = () => {
    if (!credential) return append("no credential");
    const url = credential.serverUrl.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(url);
    ws.onopen = () => {
      append(`WS open ${url}`);
      ws.send(
        JSON.stringify({ type: "subscribe", target: { kind: "system" } }),
      );
      setTimeout(() => ws.close(), 3000);
    };
    ws.onmessage = (e) => append(`WS msg ${String(e.data).slice(0, 80)}`);
    ws.onerror = (e) => append(`WS error ${JSON.stringify(e)}`);
    ws.onclose = (e) => append(`WS close code=${e.code} reason=${e.reason}`);
  };

  const clearCookies = async () => {
    await CookieManager.clearAll(false);
    await CookieManager.clearAll(true);
    setCookieValue(null);
    append("cookies cleared");
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        padding: 16,
        paddingBottom: insets.bottom + 32,
        gap: 12,
      }}
      keyboardDismissMode="on-drag"
    >
      <Text style={{ fontSize: 20, fontWeight: "600" }}>
        Connect cookie spike
      </Text>
      <Text>apex: {APEX_URL}</Text>
      <TextInput
        testID="machine-code"
        value={code}
        onChangeText={setCode}
        placeholder="machine code"
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: "#999",
          borderRadius: 8,
          padding: 10,
        }}
      />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <SpikeButton label="Redeem" onPress={redeem} />
        <SpikeButton label="Mint session + cookie" onPress={mintSession} />
        <SpikeButton label="fetch config" onPress={testFetch} />
        <SpikeButton label="WS" onPress={testWebSocket} />
        <SpikeButton
          label="WebView"
          onPress={() => setShowWebView((v) => !v)}
        />
        <SpikeButton label="Clear cookies" onPress={clearCookies} />
      </View>
      <Text>
        credential:{" "}
        {credential ? `${credential.handle} @ ${credential.serverUrl}` : "none"}
      </Text>
      <Text>cookie: {cookieValue ?? "none"}</Text>

      {credential && cookieHeader ? (
        <View style={{ gap: 4 }}>
          <Text>expo-image via shared cookie jar: {imageStatus}</Text>
          <Image
            // Mount only after the cookie exists; skip caches so a 401 from
            // an earlier attempt is never replayed.
            source={{
              uri: `${credential.serverUrl}/api/v1/system/providers/codex/logo?jar=${imageNonce}`,
            }}
            cachePolicy="none"
            style={{ width: 48, height: 48, backgroundColor: "#eee" }}
            onLoad={() => setImageStatus("loaded")}
            onError={(e) => setImageStatus(`error ${e.error}`)}
          />
          <Text>
            expo-image via explicit Cookie header: {imageStatusHeader}
          </Text>
          <Image
            source={{
              uri: `${credential.serverUrl}/api/v1/system/providers/codex/logo?hdr=${imageNonce}`,
              headers: { Cookie: cookieHeader },
            }}
            cachePolicy="none"
            style={{ width: 48, height: 48, backgroundColor: "#eee" }}
            onLoad={() => setImageStatusHeader("loaded")}
            onError={(e) => setImageStatusHeader(`error ${e.error}`)}
          />
        </View>
      ) : null}

      {showWebView && credential ? (
        <View style={{ height: 320, borderWidth: 1, borderColor: "#999" }}>
          <WebView
            source={{ uri: `${credential.serverUrl}/` }}
            sharedCookiesEnabled
            onLoadEnd={(e) =>
              append(
                `WebView loaded ${e.nativeEvent.url} title=${e.nativeEvent.title}`,
              )
            }
            onHttpError={(e) =>
              append(
                `WebView http error ${e.nativeEvent.statusCode} ${e.nativeEvent.url}`,
              )
            }
          />
        </View>
      ) : null}

      <Text style={{ fontWeight: "600", marginTop: 8 }}>Log</Text>
      {log.map((line, i) => (
        <Text key={i} style={{ fontFamily: "Menlo", fontSize: 12 }}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

function SpikeButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? "#1e3a8a" : "#2563eb",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
      })}
    >
      <Text style={{ color: "white", fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

// Dev-only route: inert in production bundles (see app/e2e/reset.tsx).
export default function ConnectSpikeRoute() {
  if (!e2eModeEnabled) return <Redirect href="/" />;
  return <ConnectSpikeScreen />;
}

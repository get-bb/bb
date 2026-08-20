// Phase 0 runtime spike screen. Not product UI.
//
// Verifies, on a real device runtime:
//   - workspace packages (@bb/*) resolve and evaluate under Hermes,
//   - @bb/sdk/browser can call the server and open the realtime socket,
//   - the Origin guard accepts RN's WebSocket,
//   - the winter polyfills the shared code relies on exist,
//   - a TextInput can render styled ranges (composer mention model spike).
import { builtInThemes } from "@bb/domain";
import { deriveConnectBaseUrl } from "@bb/connect-client";
import { createPublicApiClient } from "@bb/server-contract";
import { createBrowserBbSdk, type BrowserBbSdk } from "@bb/sdk/browser";
import { fileNameFromPath } from "@bb/thread-view";
import { Link, Redirect } from "expo-router";
import { version as reactVersion } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { e2eModeEnabled } from "@/app-shell";

const DEFAULT_SERVER_URL =
  process.env.EXPO_PUBLIC_BB_SERVER_URL ?? "http://127.0.0.1:20304";

type CheckResult = { name: string; ok: boolean; detail: string };

function runRuntimeChecks(): CheckResult[] {
  const results: CheckResult[] = [];
  const check = (name: string, fn: () => string) => {
    try {
      results.push({ name, ok: true, detail: fn() });
    } catch (error) {
      results.push({ name, ok: false, detail: String(error) });
    }
  };
  check("react version", () => reactVersion);
  check("@bb/domain builtInThemes", () => String(builtInThemes.length));
  check("@bb/thread-view fileNameFromPath", () => fileNameFromPath("a/b/c.ts"));
  check("@bb/connect-client deriveConnectBaseUrl", () =>
    deriveConnectBaseUrl("https://bee.getbb.app"),
  );
  check(
    "@bb/server-contract createPublicApiClient",
    () => typeof createPublicApiClient("http://x").system.config.$get,
  );
  check("crypto.getRandomValues", () => {
    const arr = new Uint8Array(4);
    globalThis.crypto.getRandomValues(arr);
    return Array.from(arr).join(",");
  });
  check("URL setters + searchParams", () => {
    const u = new URL("http://h:1/p?a=1#f");
    u.protocol = "ws:";
    u.pathname = "/ws";
    u.search = "";
    u.hash = "";
    return u.toString();
  });
  check("TextDecoder fatal throws on invalid utf-8", () => {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff]));
    } catch {
      return "throws (good)";
    }
    throw new Error("did not throw");
  });
  check("structuredClone", () => JSON.stringify(structuredClone({ a: [1] })));
  check("AbortSignal.timeout", () => typeof AbortSignal.timeout);
  check(
    "fetch impl",
    () => (globalThis.fetch as { name?: string }).name ?? "?",
  );
  check("Blob from ArrayBuffer", () => {
    const b = new Blob([
      new Uint8Array([1, 2, 3]).buffer as unknown as BlobPart,
    ]);
    return `size=${b.size}`;
  });
  check("FormData.set", () => typeof new FormData().set);
  return results;
}

function SpikeScreen() {
  const insets = useSafeAreaInsets();
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [log, setLog] = useState<string[]>([]);
  const [wsState, setWsState] = useState("idle");
  const sdkRef = useRef<BrowserBbSdk | null>(null);
  const unsubscribeRef = useRef<(() => void)[]>([]);
  const checks = useMemo(() => runRuntimeChecks(), []);

  // Leaving the screen closes the SDK realtime socket (the client keeps
  // reconnecting and logging errors otherwise).
  useEffect(
    () => () => {
      unsubscribeRef.current.forEach((fn) => fn());
      unsubscribeRef.current = [];
    },
    [],
  );

  const append = (line: string) =>
    setLog((prev) =>
      [`${new Date().toISOString().slice(11, 19)} ${line}`, ...prev].slice(
        0,
        40,
      ),
    );

  const getSdk = () => {
    if (!sdkRef.current) {
      sdkRef.current = createBrowserBbSdk({
        baseUrl: serverUrl,
        fetch: (input, init) => {
          // Never spread a Headers instance (RN's polyfill exposes internal
          // fields as enumerable props, which expo/fetch cannot cast).
          const headers = new Headers(init?.headers);
          headers.set("x-bb-app-surface", "mobile");
          return fetch(input, { ...init, headers });
        },
      });
    }
    return sdkRef.current;
  };

  const probeHttp = async () => {
    try {
      const config = await getSdk().system.config();
      append(
        `HTTP ok: serverUrl=${config.serverUrl} primaryHostId=${config.primaryHostId} voice=${config.voiceTranscriptionEnabled}`,
      );
    } catch (error) {
      append(`HTTP error: ${String(error)}`);
    }
  };

  const openRealtime = () => {
    const sdk = getSdk();
    unsubscribeRef.current.forEach((fn) => fn());
    unsubscribeRef.current = [
      sdk.subscribe({
        event: "realtime:connection",
        callback: (event) => {
          setWsState(event.state);
          append(
            `WS ${event.state}${event.reconnected ? " (reconnected)" : ""}`,
          );
        },
      }),
      sdk.subscribe({
        event: "system:changed",
        callback: (event) =>
          append(`system changed: ${event.changes.join(",")}`),
      }),
      sdk.subscribe({
        event: "thread:changed",
        callback: (event) =>
          append(
            `thread changed ${event.id ?? "?"}: ${event.changes.join(",")}`,
          ),
      }),
    ];
  };

  const pokeSystem = async () => {
    try {
      await getSdk().system.reloadConfig();
      append("poked: POST /system/config/reload");
    } catch (error) {
      append(`poke error: ${String(error)}`);
    }
  };

  const rawWebSocket = () => {
    const url = serverUrl.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(url);
    ws.onopen = () => {
      append(`raw WS open ${url}`);
      ws.send(
        JSON.stringify({ type: "subscribe", target: { kind: "system" } }),
      );
    };
    ws.onmessage = (e) => append(`raw WS msg ${String(e.data).slice(0, 80)}`);
    ws.onerror = (e) => append(`raw WS error ${JSON.stringify(e)}`);
    ws.onclose = (e) =>
      append(`raw WS close code=${e.code} reason=${e.reason}`);
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
        bb mobile — Phase 0 spike
      </Text>

      <Text style={{ fontWeight: "600" }}>Server URL</Text>
      <TextInput
        testID="server-url"
        value={serverUrl}
        onChangeText={setServerUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={{
          borderWidth: 1,
          borderColor: "#999",
          borderRadius: 8,
          padding: 10,
        }}
      />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <SpikeButton
          testID="probe-http"
          label="Probe HTTP"
          onPress={probeHttp}
        />
        <SpikeButton
          testID="open-realtime"
          label="Open realtime (sdk)"
          onPress={openRealtime}
        />
        <SpikeButton testID="raw-ws" label="Raw /ws" onPress={rawWebSocket} />
        <SpikeButton
          testID="poke-system"
          label="Poke (reload config)"
          onPress={pokeSystem}
        />
        <SpikeButton
          testID="clear-log"
          label="Clear"
          onPress={() => {
            unsubscribeRef.current.forEach((fn) => fn());
            unsubscribeRef.current = [];
            sdkRef.current = null;
            setLog([]);
            setWsState("idle");
          }}
        />
      </View>
      <Text testID="ws-state">realtime: {wsState}</Text>
      <Link href="/dev/connect-spike" style={{ color: "#2563eb" }}>
        Connect cookie spike →
      </Link>

      <Text style={{ fontWeight: "600", marginTop: 8 }}>Log</Text>
      {log.slice(0, 8).map((line, i) => (
        <Text
          key={i}
          testID={i === 0 ? "log-latest" : undefined}
          style={{ fontFamily: "Menlo", fontSize: 12 }}
        >
          {line}
        </Text>
      ))}

      <Text style={{ fontWeight: "600", marginTop: 8 }}>
        Composer range spike
      </Text>
      <MentionRangeInput />

      <Text style={{ fontWeight: "600", marginTop: 8 }}>Runtime checks</Text>
      {checks.map((c) => (
        <Text
          key={c.name}
          testID={`check-${c.name}`}
          style={{ color: c.ok ? "#166534" : "#991b1b" }}
        >
          {c.ok ? "✓" : "✗"} {c.name}: {c.detail}
        </Text>
      ))}
    </ScrollView>
  );
}

function SpikeButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
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

/**
 * Prototype of the composer mention model: a plain-text TextInput whose
 * children are styled Text spans for `@token` ranges. Tests whether inline
 * styled ranges are viable (cursor stability, IME, Android) before choosing
 * between inline pills and a chip strip.
 */
function MentionRangeInput() {
  const [text, setText] = useState(
    "Ask @thread-a about @path/to/file.ts and /commit",
  );
  const parts = useMemo(() => {
    const out: { text: string; kind: "plain" | "mention" | "command" }[] = [];
    const re = /(@[\w./-]+|\/[\w-]+)/g;
    let last = 0;
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      if (start > last)
        out.push({ text: text.slice(last, start), kind: "plain" });
      out.push({
        text: m[0],
        kind: m[0].startsWith("@") ? "mention" : "command",
      });
      last = start + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last), kind: "plain" });
    return out;
  }, [text]);
  return (
    <TextInput
      testID="mention-input"
      multiline
      onChangeText={setText}
      style={{
        borderWidth: 1,
        borderColor: "#999",
        borderRadius: 8,
        padding: 10,
        minHeight: 60,
      }}
    >
      <Text>
        {parts.map((p, i) => (
          <Text
            key={i}
            style={
              p.kind === "mention"
                ? {
                    color: "#1d4ed8",
                    backgroundColor: "#dbeafe",
                    fontWeight: "600",
                  }
                : p.kind === "command"
                  ? { color: "#7c3aed", fontWeight: "600" }
                  : undefined
            }
          >
            {p.text}
          </Text>
        ))}
      </Text>
    </TextInput>
  );
}

// Dev-only route: inert in production bundles (see app/e2e/reset.tsx).
export default function SpikeRoute() {
  if (!e2eModeEnabled) return <Redirect href="/" />;
  return <SpikeScreen />;
}

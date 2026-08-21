import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useProfiles } from "@/app-shell";
import {
  PROFILE_LABEL_MAX_LENGTH,
  probeServer,
  validateDirectServerUrl,
} from "@/lib/profiles";
import { describeError } from "@/lib/describe-error";
import { useTheme } from "@/theme";
import { Button, Icon, Input, ListRow, Text, toast } from "@/ui";
import { connectEnrollHref, rawPathHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";

type SubmitState =
  | { phase: "idle" }
  | { phase: "probing" }
  | { phase: "failed"; message: string }
  | { phase: "saving" };

function defaultLabel(serverUrl: string): string {
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

/**
 * "Add server": the bb connect entry (pairing code / QR → `/connect`) and
 * the Direct-mode form — URL entry with live validation, the `/health` +
 * `/system/config` probe, the plain-http warning the plan requires for
 * non-loopback hosts, then save + activate.
 */
export function AddServerScreen() {
  const router = useRouter();
  // A deep link to a server the phone does not know arrives here with the
  // origin prefilled and the in-app path to open once the server is added.
  const params = useLocalSearchParams<{ serverUrl?: string; next?: string }>();
  const { tokens } = useTheme();
  const { profiles, addProfile, setActiveProfile } = useProfiles();
  const [url, setUrl] = useState(params.serverUrl ?? "");
  const [label, setLabel] = useState("");
  const [urlTouched, setUrlTouched] = useState(false);
  const [submit, setSubmit] = useState<SubmitState>({ phase: "idle" });

  const validation = validateDirectServerUrl(url);
  const showUrlError = urlTouched && !validation.ok && url.trim().length > 0;
  const busy = submit.phase === "probing" || submit.phase === "saving";
  const firstRun = profiles.length === 0;

  const onSubmit = async () => {
    setUrlTouched(true);
    if (!validation.ok) {
      setSubmit({ phase: "failed", message: validation.message });
      return;
    }
    const { serverUrl } = validation;
    setSubmit({ phase: "probing" });
    const probe = await probeServer(serverUrl, fetch);
    if (!probe.ok) {
      const where =
        probe.stage === "health"
          ? "Could not reach the server"
          : "Reached the server, but it does not look like bb";
      setSubmit({ phase: "failed", message: `${where}: ${probe.error}` });
      return;
    }
    setSubmit({ phase: "saving" });
    try {
      const trimmedLabel = label.trim();
      const profile = await addProfile({
        mode: "direct",
        serverUrl,
        label: (trimmedLabel || defaultLabel(serverUrl)).slice(
          0,
          PROFILE_LABEL_MAX_LENGTH,
        ),
      });
      await setActiveProfile(profile.id);
      toast.success(`Added ${profile.label}`, {
        description: probe.advertisedServerUrl
          ? `Server reports ${probe.advertisedServerUrl}; keeping ${serverUrl}.`
          : undefined,
      });
      router.dismissTo("/");
      if (params.next?.startsWith("/")) router.push(rawPathHref(params.next));
    } catch (error) {
      setSubmit({ phase: "failed", message: describeError(error) });
    }
  };

  return (
    <Screen testID="add-server-screen">
      <View className="gap-1">
        <Text variant="title">
          {firstRun ? "Connect to a bb server" : "Add a server"}
        </Text>
        <Text variant="caption">
          Pair through getbb.app from anywhere, or enter a direct URL: a LAN
          address, a Tailscale Serve URL, or http://127.0.0.1:&lt;port&gt; in
          the simulator.
        </Text>
      </View>

      <View className="overflow-hidden rounded-lg border border-border bg-card">
        <ListRow
          title="Connect with bb connect"
          subtitle="Scan or type a pairing code from bb Settings → Remote access"
          leading="Globe"
          trailing="chevron"
          onPress={() => router.push(connectEnrollHref())}
          disabled={busy}
          testID="add-server-connect"
        />
      </View>

      <Text variant="sectionLabel">Direct URL</Text>

      <View className="gap-2">
        <Text variant="label">Server URL</Text>
        <Input
          value={url}
          onChangeText={(next) => {
            setUrl(next);
            if (submit.phase === "failed") setSubmit({ phase: "idle" });
          }}
          onBlur={() => setUrlTouched(true)}
          placeholder="https://bb.example.ts.net"
          keyboardType="url"
          textContentType="URL"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
          invalid={showUrlError}
          mono
          editable={!busy}
          testID="server-url-input"
        />
        {showUrlError ? (
          <Text variant="caption" tone="destructive" testID="server-url-error">
            {validation.message}
          </Text>
        ) : null}
        {validation.ok && validation.warning === "insecure-http" ? (
          <View
            className="flex-row items-start gap-2 rounded-md border border-border bg-surface-attention px-3 py-2"
            testID="server-url-warning"
          >
            <Icon name="AlertTriangle" size={16} color={tokens.warningText} />
            <Text variant="caption" tone="warning" className="flex-1">
              Plain http is unencrypted: anyone on this network can read your
              threads. Prefer https (Tailscale Serve) outside a trusted LAN.
            </Text>
          </View>
        ) : null}
      </View>

      <View className="gap-2">
        <Text variant="label">Label (optional)</Text>
        <Input
          value={label}
          onChangeText={setLabel}
          placeholder={
            validation.ok ? defaultLabel(validation.serverUrl) : "My Mac"
          }
          maxLength={PROFILE_LABEL_MAX_LENGTH}
          autoCapitalize="words"
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
          editable={!busy}
          testID="server-label-input"
        />
      </View>

      {submit.phase === "failed" ? (
        <View
          className="rounded-md border border-surface-destructive-border bg-surface-destructive px-3 py-2"
          testID="add-server-error"
        >
          <Text variant="caption" tone="destructive">
            {submit.message}
          </Text>
        </View>
      ) : null}

      <Button
        onPress={() => void onSubmit()}
        loading={busy}
        disabled={url.trim().length === 0}
        icon="ArrowRight"
        iconPosition="right"
        testID="add-server-submit"
      >
        {submit.phase === "probing"
          ? "Checking server…"
          : submit.phase === "saving"
            ? "Saving…"
            : "Connect"}
      </Button>
    </Screen>
  );
}

import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { View, type TextInputInstance } from "react-native";
import { useProfiles } from "@/app-shell";
import {
  PROFILE_LABEL_MAX_LENGTH,
  checkDirectServer,
  pairDirectServer,
  validateDirectServerUrl,
  type DirectServerAccess,
  type DirectServerCheck,
} from "@/lib/profiles";
import { describeError } from "@/lib/describe-error";
import { describeThisDevice } from "@/lib/device-label";
import { createMobileFetch } from "@/lib/sdk/mobile-fetch";
import { Button, GroupedRow, Input, Text, toast } from "@/ui";
import { connectEnrollHref, rawPathHref } from "../shell/hrefs";
import { GroupedScreen } from "./GroupedScreen";
import { useBadgeColors } from "./settings-badges";
import { SettingsSection } from "./SettingsRows";

type SubmitState =
  | { phase: "idle" }
  | { phase: "probing" }
  | { phase: "failed"; message: string }
  | { phase: "needs-code"; serverUrl: string; message: string }
  | { phase: "pairing"; serverUrl: string }
  | { phase: "saving" };

function defaultLabel(serverUrl: string): string {
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

const pairingFetch = createMobileFetch((input, init) => fetch(input, init));

const URL_HELP =
  "Use your server’s LAN or Tailscale address. Your phone must be able to reach it.";

export function AddServerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    serverUrl?: string;
    next?: string;
    profileId?: string;
  }>();
  const colors = useBadgeColors();
  const { profiles, addProfile, updateProfile, setActiveProfile } =
    useProfiles();
  const repairProfile = profiles.find(
    (profile) => profile.id === params.profileId && profile.mode === "direct",
  );
  const repair = repairProfile?.mode === "direct" ? repairProfile : null;
  const [url, setUrl] = useState(params.serverUrl ?? repair?.serverUrl ?? "");
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [urlTouched, setUrlTouched] = useState(false);
  const [submit, setSubmit] = useState<SubmitState>(
    repair === null
      ? { phase: "idle" }
      : {
          phase: "needs-code",
          serverUrl: repair.serverUrl,
          message:
            "Enter a new sign-in code. On the server machine run `bb access pair`, or open Settings → Devices on a signed-in browser.",
        },
  );
  const labelRef = useRef<TextInputInstance>(null);

  const validation = validateDirectServerUrl(url);
  const showUrlError = urlTouched && !validation.ok && url.trim().length > 0;
  const insecure = validation.ok && validation.warning === "insecure-http";
  const busy =
    submit.phase === "probing" ||
    submit.phase === "pairing" ||
    submit.phase === "saving";
  const awaitingCode =
    submit.phase === "needs-code" || submit.phase === "pairing";
  const firstRun = profiles.length === 0;

  const save = async (
    serverUrl: string,
    access: DirectServerAccess | null,
  ): Promise<void> => {
    setSubmit({ phase: "saving" });
    try {
      if (repair !== null) {
        await updateProfile(repair.id, { access });
        await setActiveProfile(repair.id);
        toast.success(`Signed in to ${repair.label} again`);
      } else {
        const trimmedLabel = label.trim();
        const profile = await addProfile({
          mode: "direct",
          serverUrl,
          label: (trimmedLabel || defaultLabel(serverUrl)).slice(
            0,
            PROFILE_LABEL_MAX_LENGTH,
          ),
          access,
        });
        await setActiveProfile(profile.id);
        toast.success(`Added ${profile.label}`);
      }
      router.dismissTo("/");
      if (params.next?.startsWith("/")) router.push(rawPathHref(params.next));
    } catch (error) {
      setSubmit({ phase: "failed", message: describeError(error) });
    }
  };

  const settle = async (check: DirectServerCheck): Promise<void> => {
    switch (check.kind) {
      case "ready":
        await save(check.serverUrl, check.access);
        return;
      case "needs-code":
        setSubmit({
          phase: "needs-code",
          serverUrl: check.serverUrl,
          message: check.message,
        });
        return;
      case "failed":
        setSubmit({ phase: "failed", message: check.message });
        return;
    }
  };

  const onSubmit = async () => {
    setUrlTouched(true);
    if (!validation.ok) {
      setSubmit({ phase: "failed", message: validation.message });
      return;
    }
    setSubmit({ phase: "probing" });
    await settle(await checkDirectServer(validation.serverUrl, fetch));
  };

  const onPair = async () => {
    if (submit.phase !== "needs-code") return;
    const { serverUrl } = submit;
    setSubmit({ phase: "pairing", serverUrl });
    await settle(
      await pairDirectServer({
        serverUrl,
        code,
        label: `bb mobile on ${describeThisDevice()}`,
        fetchImpl: pairingFetch,
      }),
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title:
            repair !== null
              ? `Sign in to ${repair.label}`
              : firstRun
                ? "Connect to a bb server"
                : "Add server",
        }}
      />
      <GroupedScreen testID="add-server-screen">
        {repair === null ? (
          <SettingsSection footnote="Pair through getbb.app from anywhere: scan or type a pairing code from bb Settings → Mobile.">
            <GroupedRow
              title="Connect with bb connect"
              badge={{ icon: "Globe", symbol: "globe", color: colors.blue }}
              trailing="chevron"
              onPress={() => router.push(connectEnrollHref())}
              disabled={busy}
              testID="add-server-connect"
            />
          </SettingsSection>
        ) : null}

        {repair === null ? (
          <SettingsSection
            title="Server URL"
            footnote={
              showUrlError ? (
                <Text
                  variant="footnote"
                  tone="destructive"
                  testID="server-url-error"
                >
                  {validation.message}
                </Text>
              ) : insecure ? (
                <Text
                  variant="footnote"
                  tone="warning"
                  testID="server-url-warning"
                >
                  Plain http is unencrypted: anyone on this network can read
                  your threads. Prefer https (Tailscale Serve) outside a trusted
                  LAN.
                </Text>
              ) : (
                URL_HELP
              )
            }
          >
            <View className="px-1">
              <Input
                value={url}
                onChangeText={(next) => {
                  setUrl(next);
                  if (
                    submit.phase === "failed" ||
                    submit.phase === "needs-code"
                  ) {
                    setSubmit({ phase: "idle" });
                  }
                }}
                onBlur={() => setUrlTouched(true)}
                placeholder="https://bb.example.ts.net"
                keyboardType="url"
                textContentType="URL"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => labelRef.current?.focus()}
                invalid={showUrlError}
                mono
                grouped
                editable={!busy}
                testID="server-url-input"
              />
            </View>
            <View className="px-1">
              <Input
                ref={labelRef}
                value={label}
                onChangeText={setLabel}
                placeholder={
                  validation.ok
                    ? `Label (${defaultLabel(validation.serverUrl)})`
                    : "Label (optional)"
                }
                maxLength={PROFILE_LABEL_MAX_LENGTH}
                autoCapitalize="words"
                returnKeyType="go"
                onSubmitEditing={() => void onSubmit()}
                grouped
                editable={!busy}
                testID="server-label-input"
              />
            </View>
          </SettingsSection>
        ) : null}

        {awaitingCode ? (
          <SettingsSection
            title="Sign-in code"
            footnote={
              submit.phase === "needs-code" ? (
                <Text variant="footnote" testID="server-code-help">
                  {submit.message}
                </Text>
              ) : null
            }
          >
            <View className="px-1">
              <Input
                value={code}
                onChangeText={setCode}
                placeholder="XXXXX-XXXXX"
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                returnKeyType="go"
                onSubmitEditing={() => void onPair()}
                mono
                grouped
                editable={!busy}
                testID="server-code-input"
              />
            </View>
          </SettingsSection>
        ) : null}

        <View className="gap-2">
          <Button
            onPress={() => void (awaitingCode ? onPair() : onSubmit())}
            loading={busy}
            disabled={
              awaitingCode ? code.trim().length === 0 : url.trim().length === 0
            }
            icon="ArrowRight"
            iconPosition="right"
            testID="add-server-submit"
          >
            {submit.phase === "probing"
              ? "Checking server…"
              : submit.phase === "pairing"
                ? "Signing in…"
                : submit.phase === "saving"
                  ? "Saving…"
                  : awaitingCode
                    ? "Sign in"
                    : "Connect"}
          </Button>
          {submit.phase === "failed" ? (
            <Text
              variant="footnote"
              tone="destructive"
              className="px-4"
              selectable
              testID="add-server-error"
            >
              {submit.message}
            </Text>
          ) : null}
        </View>
      </GroupedScreen>
    </>
  );
}

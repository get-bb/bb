import type { ConnectCredential } from "@bb/connect-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useProfiles } from "@/app-shell";
import {
  DEFAULT_CONNECT_APEX_URL,
  describeEnrollmentError,
  redeemEnrollment,
  resolveEnrollmentTarget,
  type ConnectPairingInput,
  type EnrollmentFailure,
  type EnrollmentTargetInput,
} from "@/data/connect";
import { describeError } from "@/lib/describe-error";
import type { SessionState } from "@/lib/session";
import { useTheme } from "@/theme";
import { Button, Icon, Input, Spinner, Text, toast } from "@/ui";
import { Screen } from "../shell/Screen";
import { AccountServersList } from "./AccountServersList";
import { ConnectScanner } from "./ConnectScanner";

type Phase =
  | { kind: "form" }
  | { kind: "redeeming" }
  | { kind: "saving" }
  | { kind: "failed"; failure: EnrollmentFailure }
  | {
      kind: "enrolled";
      profileId: string;
      label: string;
      credential: ConnectCredential;
    };

interface FieldError {
  field: "code" | "server" | "apexUrl";
  message: string;
}

/**
 * bb connect enrollment: scan the pairing QR or type the code, redeem it at
 * the apex for this phone's machine credential, save the profile, make it
 * active (the connector then mints the desktop-session cookie and opens
 * realtime), and offer the account's other servers — one enrollment covers
 * all of them because the credential and the session cookie are
 * account-scoped. With `profileId` the same flow re-pairs an existing
 * profile whose credential was revoked.
 */
export function ConnectEnrollScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const params = useLocalSearchParams<{
    code?: string;
    serverUrl?: string;
    apex?: string;
    profileId?: string;
  }>();
  const { profiles, connection, addProfile, updateProfile, setActiveProfile } =
    useProfiles();
  const reauthProfile =
    params.profileId !== undefined
      ? (profiles.find(
          (profile) =>
            profile.id === params.profileId && profile.mode === "connect",
        ) ?? null)
      : null;
  const reauth = reauthProfile?.mode === "connect" ? reauthProfile : null;

  const [code, setCode] = useState(params.code ?? "");
  const [server, setServer] = useState(
    params.serverUrl ?? reauth?.serverUrl ?? "",
  );
  const [apexUrl, setApexUrl] = useState(params.apex ?? "");
  const [showAdvanced, setShowAdvanced] = useState(Boolean(params.apex));
  const [scanning, setScanning] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [fieldError, setFieldError] = useState<FieldError | null>(null);

  const busy = phase.kind === "redeeming" || phase.kind === "saving";
  const firstRun = profiles.length === 0;
  const session: SessionState | null =
    phase.kind === "enrolled" && connection?.profile.id === phase.profileId
      ? connection.session
      : null;

  const submitTarget = async (input: EnrollmentTargetInput) => {
    setFieldError(null);
    const target = resolveEnrollmentTarget(input);
    if (!target.ok) {
      setFieldError({ field: target.field, message: target.message });
      return;
    }
    setPhase({ kind: "redeeming" });
    try {
      const redeemed = await redeemEnrollment({
        apexUrl: target.apexUrl,
        code: target.code,
        label: reauth?.label,
      });
      setPhase({ kind: "saving" });
      let profileId: string;
      if (reauth) {
        const updated = await updateProfile(reauth.id, {
          serverUrl: redeemed.profile.serverUrl,
          handle: redeemed.profile.handle,
          credential: redeemed.profile.credential,
        });
        profileId = updated.id;
      } else {
        const added = await addProfile(redeemed.profile);
        profileId = added.id;
      }
      await setActiveProfile(profileId);
      setPhase({
        kind: "enrolled",
        profileId,
        label: reauth?.label ?? redeemed.profile.label,
        credential: redeemed.credential,
      });
      toast.success(
        reauth
          ? `Paired ${reauth.label} again`
          : `Paired with ${redeemed.profile.label}`,
      );
    } catch (error) {
      setPhase({ kind: "failed", failure: describeEnrollmentError(error) });
    }
  };

  const submit = () => void submitTarget({ code, server, apexUrl });

  const onScanned = (input: ConnectPairingInput) => {
    setScanning(false);
    setCode(input.code);
    if (input.serverUrl) setServer(input.serverUrl);
    if (input.apexUrl) {
      setApexUrl(input.apexUrl);
      setShowAdvanced(true);
    }
    void submitTarget({
      code: input.code,
      server: input.serverUrl ?? server,
      apexUrl: input.apexUrl ?? apexUrl,
    });
  };

  if (phase.kind === "enrolled") {
    return (
      <Screen testID="connect-enrolled-screen">
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <Icon name="CircleCheck" size={22} color={tokens.success} />
            <Text variant="title">
              {reauth ? "Paired again" : "Paired with bb connect"}
            </Text>
          </View>
          <Text variant="caption">
            This phone is now a device on your getbb.app account. You can revoke
            it any time in the dashboard under Machines.
          </Text>
        </View>

        <View
          className="gap-1 rounded-lg border border-border bg-card px-4 py-3"
          testID="connect-enrolled-card"
        >
          <Text variant="label">{phase.label}</Text>
          <Text variant="caption" mono>
            {phase.credential.serverUrl}
          </Text>
          <SessionStatusLine session={session} />
        </View>

        <AccountServersList credential={phase.credential} />

        <Button
          onPress={() => router.dismissTo("/")}
          icon="ArrowRight"
          iconPosition="right"
          testID="connect-done"
        >
          Done
        </Button>
      </Screen>
    );
  }

  return (
    <Screen testID="connect-screen">
      <View className="gap-1">
        <Text variant="title">
          {reauth
            ? `Sign in again to ${reauth.label}`
            : firstRun
              ? "Connect to getbb.app"
              : "Pair with bb connect"}
        </Text>
        <Text variant="caption">
          {reauth
            ? "This phone's access was revoked or has expired. Generate a new pairing code on the server and enter it here; your saved server keeps its place."
            : "Pair this phone with your bb server through getbb.app. Generate a code in bb Settings → Remote access → Add mobile device, or run `bb connect machine-code`."}
        </Text>
      </View>

      <View className="gap-2">
        {scanning ? (
          <ConnectScanner active={!busy} onScanned={onScanned} />
        ) : null}
        <Button
          variant={scanning ? "outline" : "secondary"}
          icon={scanning ? "X" : "GridView"}
          onPress={() => setScanning((value) => !value)}
          disabled={busy}
          testID="connect-scan-toggle"
        >
          {scanning ? "Stop scanning" : "Scan QR code"}
        </Button>
      </View>

      <View className="gap-2">
        <Text variant="label">Pairing code</Text>
        <Input
          value={code}
          onChangeText={(next) => {
            setCode(next);
            if (phase.kind === "failed") setPhase({ kind: "form" });
          }}
          placeholder="ABCD-EFGH"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="next"
          invalid={fieldError?.field === "code"}
          mono
          editable={!busy}
          testID="connect-code-input"
        />
        {fieldError?.field === "code" ? (
          <Text variant="caption" tone="destructive">
            {fieldError.message}
          </Text>
        ) : null}
      </View>

      <View className="gap-2">
        <Text variant="label">Server (handle or URL)</Text>
        <Input
          value={server}
          onChangeText={setServer}
          placeholder="bee or https://bee.getbb.app"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={submit}
          invalid={fieldError?.field === "server"}
          mono
          editable={!busy && reauth === null}
          testID="connect-server-input"
        />
        <Text variant="caption">
          {reauth
            ? "The server is fixed when signing in again."
            : "Optional: the code already names the server. A URL also sets the bb connect address for self-hosted gates."}
        </Text>
        {fieldError?.field === "server" ? (
          <Text variant="caption" tone="destructive">
            {fieldError.message}
          </Text>
        ) : null}
      </View>

      {showAdvanced ? (
        <View className="gap-2">
          <Text variant="label">bb connect address</Text>
          <Input
            value={apexUrl}
            onChangeText={setApexUrl}
            placeholder={DEFAULT_CONNECT_APEX_URL}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            invalid={fieldError?.field === "apexUrl"}
            mono
            editable={!busy}
            testID="connect-apex-input"
          />
          {fieldError?.field === "apexUrl" ? (
            <Text variant="caption" tone="destructive">
              {fieldError.message}
            </Text>
          ) : null}
        </View>
      ) : (
        <Button
          variant="link"
          size="sm"
          className="self-start"
          onPress={() => setShowAdvanced(true)}
          testID="connect-advanced-toggle"
        >
          Self-hosted bb connect…
        </Button>
      )}

      {phase.kind === "failed" ? (
        <View
          className="gap-1 rounded-md border border-surface-destructive-border bg-surface-destructive px-3 py-2"
          testID="connect-error"
        >
          <Text variant="label" tone="destructive">
            {phase.failure.title}
          </Text>
          <Text variant="caption" tone="destructive">
            {phase.failure.message}
          </Text>
        </View>
      ) : null}

      <Button
        onPress={submit}
        loading={busy}
        disabled={code.trim().length === 0}
        icon="ArrowRight"
        iconPosition="right"
        testID="connect-submit"
      >
        {phase.kind === "redeeming"
          ? "Pairing…"
          : phase.kind === "saving"
            ? "Saving…"
            : reauth
              ? "Sign in again"
              : "Pair"}
      </Button>

      {!reauth ? (
        <Button
          variant="ghost"
          onPress={() => router.push("/settings/servers/add")}
          disabled={busy}
          testID="connect-use-direct"
        >
          Use a direct URL instead
        </Button>
      ) : null}
    </Screen>
  );
}

/** The connect session for the just-enrolled profile, as the connector sees it. */
function SessionStatusLine({ session }: { session: SessionState | null }) {
  const { tokens } = useTheme();
  if (session === null || session.status === "idle") {
    return (
      <View className="flex-row items-center gap-2 pt-1">
        <Spinner />
        <Text variant="caption">Activating…</Text>
      </View>
    );
  }
  switch (session.status) {
    case "authenticating":
      return (
        <View className="flex-row items-center gap-2 pt-1">
          <Spinner />
          <Text variant="caption" testID="connect-session-authenticating">
            Signing in…
          </Text>
        </View>
      );
    case "authenticated":
      return (
        <View className="flex-row items-center gap-2 pt-1">
          <Icon name="Check" size={16} color={tokens.success} />
          <Text
            variant="caption"
            tone="success"
            testID="connect-session-authenticated"
          >
            Signed in. Session renews automatically.
          </Text>
        </View>
      );
    case "auth-required":
      return (
        <Text
          variant="caption"
          tone="destructive"
          testID="connect-session-auth-required"
        >
          bb connect rejected the new credential: {session.detail}
        </Text>
      );
    case "error":
      return (
        <Text variant="caption" tone="warning" testID="connect-session-error">
          Could not sign in yet ({describeError(session.detail)}). Retrying…
        </Text>
      );
  }
}

import { useEffect, useState } from "react";
import { View } from "react-native";
import type { MobileSealedState } from "@/lib/sealed";
import type { ProfileClient } from "@/lib/sdk";
import { Button, Input, Text } from "@/ui";

export function sealedBannerBlocks(state: MobileSealedState | null): boolean {
  return (
    state !== null &&
    (state.kind === "pending" ||
      state.kind === "rejected" ||
      state.kind === "key-mismatch" ||
      (state.kind === "ready" && !state.verified && !state.acknowledged))
  );
}

export function useSealedState(
  client: ProfileClient | null,
): MobileSealedState | null {
  const [state, setState] = useState<MobileSealedState | null>(
    client?.sealed?.getState() ?? null,
  );
  useEffect(() => {
    if (client === null || client.sealed === null) {
      setState(null);
      return;
    }
    setState(client.sealed.getState());
    return client.onSealedStateChange(setState);
  }, [client]);
  return state;
}

export function SealedStateBanner({
  client,
  onRepair,
}: {
  client: ProfileClient | null;
  onRepair: () => void;
}) {
  const state = useSealedState(client);
  const [code, setCode] = useState("");
  if (client === null || state === null) return null;
  if (state.kind === "plaintext") {
    if (state.accepted) return null;
    return (
      <View
        className="absolute inset-x-0 bottom-0 gap-3 border-t border-border bg-background p-4"
        testID="sealed-state-banner"
      >
        <Text variant="headline">Readable connection</Text>
        <Text variant="caption">
          This bb does not offer sealed connections ({state.reason}), so the
          Connect relay could read this traffic. Nothing is sent until you
          continue. Update the bb server, or pair again by QR code once it
          supports sealed connections.
        </Text>
        <Button
          onPress={() => client.sealed?.acceptPlaintext()}
          testID="sealed-plaintext-accept"
        >
          Continue with a readable connection
        </Button>
      </View>
    );
  }
  if (state.kind === "offline" && state.fingerprint === null) {
    return (
      <View
        className="absolute inset-x-0 bottom-0 gap-3 border-t border-border bg-background p-4"
        testID="sealed-state-banner"
      >
        <Text variant="headline">Could not check this bb's encryption</Text>
        <Text variant="caption">
          The sealed-connection probe failed ({state.error}). Nothing is sent
          until it succeeds, so a relay cannot quietly downgrade this phone.
        </Text>
        <Button
          onPress={() => void client.sealed?.probe().catch(() => undefined)}
          testID="sealed-probe-retry"
        >
          Try again
        </Button>
      </View>
    );
  }
  if (!sealedBannerBlocks(state)) return null;
  const submitCode = () => {
    const trimmed = code.trim();
    if (trimmed.replace(/[^A-Za-z0-9]/gu, "").length < 12) return;
    client.sealed?.useDeviceCode(trimmed.toUpperCase());
    setCode("");
  };
  return (
    <View
      className="absolute inset-x-0 bottom-0 gap-3 border-t border-border bg-background p-4"
      testID="sealed-state-banner"
    >
      {state.kind === "ready" && !state.verified && !state.acknowledged ? (
        <>
          <Text variant="headline">Check this bb's key</Text>
          <Text variant="caption">
            This is the first sealed contact with this bb. Compare the
            fingerprint below with bb connect encryption on the computer running
            bb; a relay that substituted its own key would show a different one.
            Nothing is sent until you choose.
          </Text>
          <Text variant="caption" mono selectable>
            {state.fingerprint}
          </Text>
          <Button
            onPress={() => void client.sealed?.markVerified()}
            testID="sealed-first-contact-verified"
          >
            The fingerprints match
          </Button>
          <Button
            variant="outline"
            onPress={() => void client.sealed?.acceptUnverified()}
            testID="sealed-first-contact-continue"
          >
            Continue without checking
          </Button>
          <Input
            value={code}
            onChangeText={setCode}
            placeholder="ABCD-EFGH-JKLM"
            autoCapitalize="characters"
            autoCorrect={false}
            testID="sealed-device-code"
          />
          <Button onPress={submitCode} testID="sealed-device-code-submit">
            Use device code
          </Button>
        </>
      ) : null}
      {state.kind === "pending" ? (
        <>
          <Text variant="headline">Waiting for approval</Text>
          <Text variant="caption">
            Approve device {state.deviceId} on the computer running bb after
            checking that its key fingerprint matches, or enter a device code
            from bb connect device-code.
          </Text>
          <Text variant="caption" mono selectable>
            {state.fingerprint}
          </Text>
          <Input
            value={code}
            onChangeText={setCode}
            placeholder="ABCD-EFGH-JKLM"
            autoCapitalize="characters"
            autoCorrect={false}
            testID="sealed-device-code"
          />
          <Button onPress={submitCode} testID="sealed-device-code-submit">
            Use device code
          </Button>
        </>
      ) : null}
      {state.kind === "rejected" ? (
        <>
          <Text variant="headline">This phone was refused</Text>
          <Text variant="caption">
            {state.reason === "revoked"
              ? "The bb server revoked this phone. Ask the owner to remove it there, then pair again."
              : state.reason === "invalid-code"
                ? "The device code was not accepted, or the server could not prove it knows the code. Nothing was pinned."
                : `The server refused this phone (${state.reason}).`}
          </Text>
          <Button variant="outline" onPress={onRepair}>
            Pair again
          </Button>
        </>
      ) : null}
      {state.kind === "key-mismatch" ? (
        <>
          <Text variant="headline">The server key changed</Text>
          <Text variant="caption">
            Expected {state.expected} but the server presented {state.actual}.
            Either the owner rotated the key or something is impersonating the
            server. Pair again with a fresh QR code from a trusted screen.
          </Text>
          <Button variant="outline" onPress={onRepair}>
            Pair again
          </Button>
        </>
      ) : null}
    </View>
  );
}

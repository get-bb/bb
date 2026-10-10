import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import {
  getActiveSealedConnection,
  useReadableConnectionReason,
  useSealedState,
} from "@/lib/sealed";

function describe(
  state: NonNullable<ReturnType<typeof useSealedState>>,
): string {
  switch (state.kind) {
    case "ready":
      return "Requests, realtime messages, and the images, files, and previews the app loads itself are encrypted before they reach the Connect relay. Media that plugin pages add on their own is rerouted after it appears, so treat it as best effort.";
    case "pending":
      return "Waiting for the bb server to approve this device.";
    case "offline":
      return `The sealed connection dropped (${state.error}); retrying without a readable fallback.`;
    case "connecting":
      return "Opening the sealed connection…";
    case "rejected":
      return `The server refused this device (${state.reason}).`;
    case "key-mismatch":
      return "The server key changed; reload to review the new fingerprint.";
    case "idle":
      return "Not connected.";
  }
}

export function SealedConnectionSettingsSection() {
  const state = useSealedState();
  const connection = getActiveSealedConnection();
  const readableReason = useReadableConnectionReason();
  const [busy, setBusy] = useState(false);
  if (state === null || connection === null) {
    if (readableReason === null) return null;
    return (
      <SettingsSection
        title="Sealed transport"
        description={`Not in use: ${readableReason}. If this bb is open through a relay, that relay can read this page's requests. Turn on "Require sealed connections" on the bb server to refuse readable access.`}
      >
        <p className="text-xs text-muted-foreground">
          Reload after the server starts offering sealed connections.
        </p>
      </SettingsSection>
    );
  }
  const fingerprint =
    state.kind === "ready" ||
    state.kind === "pending" ||
    state.kind === "offline" ||
    state.kind === "rejected"
      ? state.fingerprint
      : null;
  const verified =
    state.kind === "ready" || state.kind === "pending" ? state.verified : false;
  return (
    <SettingsSection
      title="Sealed transport"
      description="This bb is open through a relay. Requests and realtime messages travel as ciphertext the relay cannot read; the page code itself still comes from the relay."
    >
      <div className="space-y-4">
        <SettingsWithControl
          label="Connection"
          description={describe(state)}
          controlPlacement="trailing"
        >
          <span className="text-xs text-muted-foreground">{state.kind}</span>
        </SettingsWithControl>
        {fingerprint !== null ? (
          <SettingsWithControl
            label="Server key fingerprint"
            description={
              verified
                ? "You confirmed this fingerprint matches the one shown on the bb server."
                : "Compare with Settings → Remote access or `bb connect encryption` on the server, then mark it verified. Until then the key is trusted on first use."
            }
            controlPlacement="trailing"
          >
            <div className="flex flex-col items-end gap-2">
              <code className="font-mono text-xs tracking-wide">
                {fingerprint}
              </code>
              {!verified ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void connection
                      .markVerified()
                      .finally(() => setBusy(false));
                  }}
                >
                  Mark as verified
                </Button>
              ) : null}
            </div>
          </SettingsWithControl>
        ) : null}
        <SettingsWithControl
          label="Forget this server's key"
          description="Clears the pinned key and this browser's device key. The next visit enrolls as a new device."
          controlPlacement="trailing"
        >
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void connection
                .forgetTrust()
                .then(() => window.location.reload());
            }}
          >
            Forget
          </Button>
        </SettingsWithControl>
      </div>
    </SettingsSection>
  );
}

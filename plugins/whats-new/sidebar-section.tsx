import { useEffect, useState } from "react";
import {
  experimental_usePluginId,
  useRpc,
  useSdk,
  type ExperimentalSidebarFooterSectionProps,
} from "@get-bb/plugin-sdk/app";
import {
  WHATS_NEW_NOTES_HREF,
  WhatsNewCard,
  WhatsNewConfirmationNudge,
  type WhatsNewConfirmation,
} from "./card.js";
import type { whatsNewRpcContract } from "./contract.js";
import {
  isWhatsNewVersionUnseen,
  markWhatsNewVersionSeen,
  recordWhatsNewBaseline,
  useWhatsNewSeenVersion,
} from "./seen.js";
import {
  setWhatsNewEnabledOverride,
  useWhatsNewEnabled,
  type ReleaseNotes,
} from "./state.js";

export const whatsNewNotesNavigation = {
  open(href: string) {
    window.location.assign(href);
  },
};

function useInstalledRelease(): ReleaseNotes | null {
  const sdk = useSdk();
  const [release, setRelease] = useState<ReleaseNotes | null>(null);
  useEffect(() => {
    let active = true;
    sdk.system.experimental_releaseNotes().then(
      (result) => {
        if (active) setRelease(result.releases[0] ?? null);
      },
      () => {
        if (active) setRelease(null);
      },
    );
    return () => {
      active = false;
    };
  }, [sdk]);
  return release;
}

export function WhatsNewSidebarSection({
  onNavigate,
}: ExperimentalSidebarFooterSectionProps) {
  const rpc = useRpc<typeof whatsNewRpcContract>();
  const pluginId = experimental_usePluginId();
  const enabled = useWhatsNewEnabled();
  const seenVersion = useWhatsNewSeenVersion();
  const release = useInstalledRelease();
  const [confirmation, setConfirmation] = useState<{
    state: WhatsNewConfirmation;
    release: ReleaseNotes;
  } | null>(null);

  useEffect(() => {
    if (release !== null && seenVersion.length === 0) {
      recordWhatsNewBaseline(release.version);
    }
  }, [release, seenVersion]);

  const setEnabled = (next: boolean) => {
    setWhatsNewEnabledOverride(next, enabled);
    void rpc.call("setEnabled", { enabled: next }).catch(() => {});
  };

  if (confirmation !== null) {
    const { release: dismissed } = confirmation;
    return (
      <WhatsNewConfirmationNudge
        key={confirmation.state}
        release={dismissed}
        state={confirmation.state}
        settingsHref={`/settings/plugins/${pluginId}`}
        onTurnOff={() => {
          setConfirmation({ state: "off", release: dismissed });
          setEnabled(false);
        }}
        onUndo={() => {
          setConfirmation({ state: "hidden", release: dismissed });
          setEnabled(true);
        }}
        onClose={() => setConfirmation(null)}
      />
    );
  }
  if (
    enabled !== true ||
    release === null ||
    !isWhatsNewVersionUnseen(seenVersion, release.version)
  ) {
    return null;
  }
  return (
    <WhatsNewCard
      release={release}
      onOpen={() => {
        markWhatsNewVersionSeen(release.version);
        onNavigate();
        whatsNewNotesNavigation.open(WHATS_NEW_NOTES_HREF);
      }}
      onDismiss={() => {
        markWhatsNewVersionSeen(release.version);
        setConfirmation({ state: "hidden", release });
      }}
    />
  );
}

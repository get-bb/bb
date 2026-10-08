import { useEffect, useState } from "react";
import {
  experimental_usePluginId,
  useRpc,
  useSdk,
  type ExperimentalSidebarFooterSectionProps,
} from "@get-bb/plugin-sdk/app";
import { WhatsNewCard, WhatsNewOffNotice } from "./card.js";
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
  const [turnedOff, setTurnedOff] = useState(false);

  useEffect(() => {
    if (release !== null && seenVersion.length === 0) {
      recordWhatsNewBaseline(release.version);
    }
  }, [release, seenVersion]);

  const setEnabled = (next: boolean) => {
    setWhatsNewEnabledOverride(next, enabled);
    void rpc.call("setEnabled", { enabled: next }).catch(() => {});
  };

  if (turnedOff) {
    return (
      <WhatsNewOffNotice
        settingsHref={`/settings/plugins/${pluginId}`}
        onUndo={() => {
          setTurnedOff(false);
          setEnabled(true);
        }}
        onClose={() => setTurnedOff(false)}
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
      }}
      onDismiss={() => markWhatsNewVersionSeen(release.version)}
      onTurnOff={() => {
        setTurnedOff(true);
        setEnabled(false);
      }}
    />
  );
}

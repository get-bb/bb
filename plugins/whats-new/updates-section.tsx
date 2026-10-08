import { useEffect, useState } from "react";
import { useSdk, type PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { WhatsNewNotes, type WhatsNewNotesData } from "./notes.js";
import { compareVersions, visitWhatsNewVersion } from "./seen.js";
import { useWhatsNewEnabled, type ReleaseNotes } from "./state.js";

async function loadSkipped(
  sdk: PluginBrowserBbSdk,
  current: ReleaseNotes,
  previous: string,
): Promise<ReleaseNotes[]> {
  const result = await sdk.system.experimental_releaseNotes({
    since: previous,
  });
  return result.releases.filter(
    (release) => compareVersions(release.version, current.version) < 0,
  );
}

async function loadAvailable(
  sdk: PluginBrowserBbSdk,
  current: ReleaseNotes,
): Promise<ReleaseNotes | null> {
  const version = await sdk.system.version();
  const latest = version.updateAvailable ? version.latestVersion : null;
  if (latest === null || compareVersions(latest, current.version) <= 0) {
    return null;
  }
  const result = await sdk.system.experimental_releaseNotes({
    version: latest,
  });
  return result.releases[0] ?? null;
}

function useWhatsNewNotes(enabled: boolean): WhatsNewNotesData | null {
  const sdk = useSdk();
  const [data, setData] = useState<WhatsNewNotesData | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const update = (patch: Partial<WhatsNewNotesData>) => {
      if (active)
        setData((value) => (value === null ? value : { ...value, ...patch }));
    };
    void sdk.system.experimental_releaseNotes().then(
      (result) => {
        const current = result.releases[0];
        if (!active || current === undefined) return;
        const previous = visitWhatsNewVersion(current.version);
        const updatedFrom =
          previous !== null && compareVersions(previous, current.version) < 0
            ? previous
            : null;
        setData({ current, skipped: [], updatedFrom, available: null });
        if (updatedFrom !== null) {
          loadSkipped(sdk, current, updatedFrom).then(
            (skipped) => update({ skipped }),
            () => {},
          );
        }
        loadAvailable(sdk, current).then(
          (available) => update({ available }),
          () => {},
        );
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [enabled, sdk]);
  return data;
}

export function WhatsNewUpdatesSection() {
  const enabled = useWhatsNewEnabled();
  const data = useWhatsNewNotes(enabled === true);
  if (enabled !== true || data === null) {
    return null;
  }
  return <WhatsNewNotes {...data} />;
}

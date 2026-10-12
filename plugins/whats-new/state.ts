import { useEffect, useSyncExternalStore } from "react";
import { useSettings, type PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

export type ReleaseNotesResponse = Awaited<
  ReturnType<PluginBrowserBbSdk["system"]["experimental_releaseNotes"]>
>;
export type ReleaseNotes = ReleaseNotesResponse["releases"][number];
export type ReleaseNotesBlock = ReleaseNotes["lede"][number];

export const UPDATES_ROUTE = "/settings/updates";
export const CHANGELOG_URL = "https://getbb.app/changelog";

export function changelogUrl(version: string): string {
  return `${CHANGELOG_URL}#${version.replaceAll(".", "-")}`;
}

interface EnabledOverride {
  enabled: boolean;
  basis: boolean;
}

let enabledOverride: EnabledOverride | null = null;
const enabledListeners = new Set<() => void>();

function subscribeEnabledOverride(listener: () => void): () => void {
  enabledListeners.add(listener);
  return () => {
    enabledListeners.delete(listener);
  };
}

function readEnabledOverride(): EnabledOverride | null {
  return enabledOverride;
}

function writeEnabledOverride(next: EnabledOverride | null): void {
  enabledOverride = next;
  for (const listener of enabledListeners) {
    listener();
  }
}

export function setWhatsNewEnabledOverride(
  enabled: boolean,
  basis: boolean | null,
): void {
  writeEnabledOverride({ enabled, basis: basis ?? !enabled });
}

export function resetWhatsNewEnabledOverrideForTest(): void {
  enabledOverride = null;
}

export function useWhatsNewEnabled(): boolean | null {
  const settings = useSettings();
  const override = useSyncExternalStore(
    subscribeEnabledOverride,
    readEnabledOverride,
    readEnabledOverride,
  );
  const stored =
    settings.values === undefined ? null : settings.values.enabled !== false;
  const settled =
    override !== null && stored !== null && stored !== override.basis;
  useEffect(() => {
    if (settled) {
      writeEnabledOverride(null);
    }
  }, [settled]);
  if (override !== null && !settled) {
    return override.enabled;
  }
  return stored;
}

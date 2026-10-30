import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";

const RELEASE_NOTES_BASE_URL = "https://getbb.app/changelog";

export type ReleaseNotesView = "inline" | "web";

export function getReleaseNotesUrl(version: string): string {
  return `${RELEASE_NOTES_BASE_URL}#${version.replaceAll(".", "-")}`;
}

export function recordReleaseNotesOpened(
  version: string,
  view: ReleaseNotesView,
): void {
  recordTelemetryEvent({
    name: "release_notes_opened",
    properties: { release_version: version, view },
  });
}

export function openReleaseNotesOnWeb(
  version: string,
  notesVersion: string,
): void {
  openUrlInExternalBrowser(getReleaseNotesUrl(notesVersion));
  recordReleaseNotesOpened(version, "web");
}

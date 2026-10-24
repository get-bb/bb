import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import { isReleaseVersion } from "@/components/sidebar/release-widget-model";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";

const RELEASE_NOTES_BASE_URL = "https://getbb.app/changelog";

export type ReleaseNotesEntryPoint = "widget" | "updates_link";

export function getReleaseNotesUrl(version: string): string {
  return `${RELEASE_NOTES_BASE_URL}#${version.replaceAll(".", "-")}`;
}

export function viewReleaseNotes(
  version: string,
  entryPoint: ReleaseNotesEntryPoint,
): void {
  openUrlInExternalBrowser(getReleaseNotesUrl(version));
  if (!isReleaseVersion(version)) {
    return;
  }
  recordTelemetryEvent({
    name: "release_notes_opened",
    properties: { release_version: version, entry_point: entryPoint },
  });
}

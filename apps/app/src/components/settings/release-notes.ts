import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import {
  nightlyBaseVersion,
  type SourceUpdateNotes,
} from "./release-notes-model";

const RELEASE_NOTES_BASE_URL = "https://getbb.app/changelog";
const SOURCE_REPOSITORY_URL = "https://github.com/get-bb/bb";

export type ReleaseNotesView = "inline" | "web";

export function getReleaseNotesUrl(version: string): string {
  return `${RELEASE_NOTES_BASE_URL}#${version.replaceAll(".", "-")}`;
}

export function getSourceCompareUrl(update: SourceUpdateNotes): string {
  return update.from === null
    ? `${SOURCE_REPOSITORY_URL}/commits/${update.to}`
    : `${SOURCE_REPOSITORY_URL}/compare/${update.from}...${update.to}`;
}

export function recordReleaseNotesOpened(
  version: string,
  view: ReleaseNotesView,
): void {
  recordTelemetryEvent({
    name: "release_notes_opened",
    properties: {
      release_version: nightlyBaseVersion(version) ?? version,
      view,
    },
  });
}

export function openReleaseNotesOnWeb(
  version: string,
  notesVersion: string,
): void {
  openUrlInExternalBrowser(getReleaseNotesUrl(notesVersion));
  recordReleaseNotesOpened(version, "web");
}

export function openSourceCompareOnWeb(
  version: string,
  update: SourceUpdateNotes,
): void {
  openUrlInExternalBrowser(getSourceCompareUrl(update));
  recordReleaseNotesOpened(version, "web");
}

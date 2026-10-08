import type { ReactNode } from "react";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { SettingsStoryChrome } from "../../../.ladle/story-settings-chrome";
import { SettingsUpdatesStory } from "../../../.ladle/settings-story-fixtures";
import { WhatsNewView } from "./WhatsNewSection";
import {
  CHANGELOG_ENTRIES,
  RELEASE_META,
  selectWhatsNewReleases,
  type ChangelogEntry,
  type ReleaseMeta,
  type WhatsNewReleases,
} from "./changelog-preview";

export default {
  title: "settings/Updates/What's new",
};

function releasesFor(
  installedVersion: string,
  previousVersion: string | null,
): WhatsNewReleases {
  const releases = selectWhatsNewReleases({
    entries: CHANGELOG_ENTRIES,
    installedVersion,
    previousVersion,
  });
  if (releases === null) {
    throw new Error(`Missing changelog fixture ${installedVersion}`);
  }
  return releases;
}

function viewFor(
  installedVersion: string,
  previousVersion: string | null,
): { releases: WhatsNewReleases; meta: ReleaseMeta | null } {
  const releases = releasesFor(installedVersion, previousVersion);
  return { releases, meta: RELEASE_META[releases.current.version] ?? null };
}

function withPlaceholderHero(meta: ReleaseMeta | null): ReleaseMeta | null {
  return meta === null
    ? null
    : {
        ...meta,
        hero: {
          src: "https://getbb.app/marketplace/v2/screenshots/automations/automations-catalog.png",
          alt: "Placeholder screenshot from the Automations catalog",
        },
      };
}

function entryFor(version: string): ChangelogEntry {
  const entry = CHANGELOG_ENTRIES.find(
    (candidate) => candidate.version === version,
  );
  if (entry === undefined) {
    throw new Error(`Missing changelog fixture ${version}`);
  }
  return entry;
}

const UNANNOUNCED_RELEASE: ChangelogEntry = {
  version: "99.0.0",
  lede: [
    {
      kind: "paragraph",
      text: "A release whose headline and date have not been published yet.",
    },
  ],
  sections: [
    {
      title: "Highlights",
      blocks: [
        {
          kind: "list",
          items: [
            "**Release notes in Settings:** Settings → Updates keeps the installed release and anything you skipped.",
          ],
        },
      ],
    },
    {
      title: "Fixes",
      blocks: [
        {
          kind: "paragraph",
          text: "Fix stale update badges after relaunching the desktop app.",
        },
      ],
    },
  ],
};

function Frame({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-3xl">{children}</div>;
}

export function InSettings() {
  return (
    <SettingsStoryChrome activeSection="updates">
      <SettingsUpdatesStory />
    </SettingsStoryChrome>
  );
}

export function States() {
  return (
    <StoryCard className="max-w-6xl" labelWidth="240px">
      <StoryRow label="Returning visit" hint="No update since the last visit.">
        <Frame>
          <WhatsNewView {...viewFor("0.45.0", null)} available={null} />
        </Frame>
      </StoryRow>
      <StoryRow
        label="Hero screenshot"
        hint="Optional per release, inside Show all changes; the image is a placeholder."
      >
        <Frame>
          <WhatsNewView
            releases={releasesFor("0.45.0", "0.44.0")}
            meta={withPlaceholderHero(RELEASE_META["0.45.0"] ?? null)}
            available={null}
          />
        </Frame>
      </StoryRow>
      <StoryRow
        label="Just updated, one release"
        hint="0.44.0 → 0.45.0, arriving from the new-thread tip."
      >
        <Frame>
          <WhatsNewView {...viewFor("0.45.0", "0.44.0")} available={null} />
        </Frame>
      </StoryRow>
      <StoryRow
        label="Skipped several releases"
        hint="0.42.0 → 0.45.0; skipped releases collapse below the installed one."
      >
        <Frame>
          <WhatsNewView {...viewFor("0.45.0", "0.42.0")} available={null} />
        </Frame>
      </StoryRow>
      <StoryRow
        label="Update available"
        hint="Installed 0.44.0; the 0.45.0 notes sit collapsed below."
      >
        <Frame>
          <WhatsNewView
            {...viewFor("0.44.0", null)}
            available={entryFor("0.45.0")}
          />
        </Frame>
      </StoryRow>
      <StoryRow
        label="Release without metadata"
        hint="No published headline or visual: the version line leads."
      >
        <Frame>
          <WhatsNewView
            releases={{
              current: UNANNOUNCED_RELEASE,
              skipped: [],
              updatedFrom: null,
            }}
            meta={null}
            available={null}
          />
        </Frame>
      </StoryRow>
      <StoryRow label="390px" hint="Narrow viewport, skipped releases.">
        <div className="w-full max-w-sm">
          <WhatsNewView {...viewFor("0.45.0", "0.42.0")} available={null} />
        </div>
      </StoryRow>
    </StoryCard>
  );
}

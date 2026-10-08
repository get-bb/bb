import { useId } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { ReleaseVisual } from "@/components/release-art/ReleaseVisual";
import {
  CHANGELOG_ENTRIES,
  RELEASE_META,
  selectWhatsNewReleases,
} from "@/components/settings/changelog-preview";
import {
  isWhatsNewVersionUnseen,
  markWhatsNewVersionSeen,
  WHATS_NEW_SECTION_ID,
} from "@/components/settings/whats-new-seen";
import { getSettingsRoutePath } from "@/lib/route-paths";

export interface SidebarWhatsNewCardProps {
  installedVersion: string;
  seenVersion: string;
  onNavigate?: () => void;
}

export function SidebarWhatsNewCard({
  installedVersion,
  seenVersion,
  onNavigate,
}: SidebarWhatsNewCardProps) {
  const navigate = useNavigate();
  const labelId = useId();
  const releases = selectWhatsNewReleases({
    entries: CHANGELOG_ENTRIES,
    installedVersion,
    previousVersion: null,
  });
  if (releases === null) {
    return null;
  }
  const { version } = releases.current;
  if (!isWhatsNewVersionUnseen(seenVersion, version)) {
    return null;
  }
  const meta = RELEASE_META[version];
  const headline = meta?.headline ?? `bb ${version}`;
  const open = () => {
    markWhatsNewVersionSeen(version);
    onNavigate?.();
    void navigate({
      pathname: getSettingsRoutePath("updates"),
      hash: WHATS_NEW_SECTION_ID,
    });
  };
  return (
    <section
      aria-labelledby={labelId}
      data-testid="sidebar-whats-new"
      data-whats-new-version={version}
      className="relative rounded-lg bg-card px-3 pb-2.5 pt-2.5 shadow-xs transition-colors has-[[data-whats-new-open]:hover]:bg-sidebar-accent/40 has-[[data-whats-new-open]:focus-visible]:ring-1 has-[[data-whats-new-open]:focus-visible]:ring-sidebar-ring motion-reduce:transition-none dark:bg-sidebar-accent/50 dark:shadow-none"
    >
      <p
        id={labelId}
        className="pr-6 text-xs leading-snug text-subtle-foreground"
      >
        What&rsquo;s new · v{version}
      </p>
      <div className="mt-1.5 flex min-w-0 items-start gap-2.5">
        <ReleaseVisual visual={meta?.visual} className="size-10" />
        <p className="line-clamp-3 min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
          {headline}
        </p>
      </div>
      <button
        type="button"
        data-whats-new-open
        aria-label={`See what's new in bb ${version}`}
        onClick={open}
        className="mt-1.5 inline-flex cursor-pointer items-center gap-0.5 text-xs font-medium text-muted-foreground after:absolute after:inset-0 after:rounded-lg after:content-[''] hover:text-foreground focus-visible:outline-none"
      >
        See what&rsquo;s new
        <Icon aria-hidden name="ChevronRight" className="size-3" />
      </button>
      <button
        type="button"
        aria-label={`Dismiss what's new in bb ${version}`}
        onClick={() => markWhatsNewVersionSeen(version)}
        className="absolute right-1.5 top-1.5 z-10 flex size-6 cursor-pointer items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-state-hover hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring motion-reduce:transition-none"
      >
        <Icon aria-hidden name="X" className="size-3.5" />
      </button>
    </section>
  );
}

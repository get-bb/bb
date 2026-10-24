import { useEffect, useId, useState } from "react";
import { useAtom } from "jotai";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import {
  CHANGELOG_ENTRIES,
  changelogEntriesQueryOptions,
} from "@/components/settings/changelog-preview";
import {
  getReleaseNotesUrl,
  viewReleaseNotes,
} from "@/components/settings/release-notes";
import { useAppUpdateStatus } from "@/hooks/queries/app-update-queries";
import { BbLogo } from "@/components/ui/bb-logo";
import { useUpdateInventory } from "@/hooks/useUpdateInventory";
import { rawStringLocalStorage } from "@/lib/browser-storage";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { isInsideNativeShell } from "@/lib/native-shell";
import { dismissedReleaseVersionAtom } from "./release-widget-preferences";
import {
  type ReleaseWidgetContent,
  type ReleaseWidgetImage,
  resolveReleaseWidgetContent,
  resolveReleaseWidgetTargetVersion,
} from "./release-widget-model";

const CHANGELOG_PREVIEW_DISMISSED_VERSION_STORAGE_KEY =
  "bb.settings.updates.dismissed-changelog-version";

const reportedShownVersions = new Set<string>();

export function resetReleaseWidgetSessionForTest(): void {
  reportedShownVersions.clear();
}

interface SidebarReleaseWidgetProps {
  visible: boolean;
}

export function SidebarReleaseWidget({ visible }: SidebarReleaseWidgetProps) {
  if (!visible || isInsideNativeShell()) {
    return null;
  }
  return <ReleaseWidget />;
}

function ReleaseWidget() {
  const inventory = useUpdateInventory();
  const appUpdate = useAppUpdateStatus().data;
  const [isDesktop] = useState(() => getBbDesktopInfo() !== null);
  const [dismissedVersion, setDismissedVersion] = useAtom(
    dismissedReleaseVersionAtom,
  );
  const updateAvailable =
    inventory.appUpdateAvailable || inventory.desktopUpdateReady;
  const version = updateAvailable
    ? resolveReleaseWidgetTargetVersion({
        isDesktop,
        desktopInfo: inventory.desktopInfo,
        appUpdate,
        systemVersion: inventory.systemVersion,
      })
    : null;
  const changelogQuery = useQuery({
    ...changelogEntriesQueryOptions(),
    enabled: version !== null,
  });
  const content =
    version === null
      ? null
      : resolveReleaseWidgetContent(
          version,
          changelogQuery.data,
          CHANGELOG_ENTRIES,
        );

  const legacyDismissed =
    version !== null &&
    dismissedVersion === null &&
    rawStringLocalStorage.getItem(
      CHANGELOG_PREVIEW_DISMISSED_VERSION_STORAGE_KEY,
      "",
    ) === version;
  const dismissed = version !== null && dismissedVersion === version;
  const shown = content !== null && !dismissed && !legacyDismissed;

  useEffect(() => {
    if (legacyDismissed) {
      setDismissedVersion((current) => current ?? version);
    }
  }, [legacyDismissed, setDismissedVersion, version]);

  useEffect(() => {
    if (!shown || version === null || reportedShownVersions.has(version)) {
      return;
    }
    reportedShownVersions.add(version);
    recordTelemetryEvent({
      name: "release_widget_shown",
      properties: { release_version: version },
    });
  }, [shown, version]);

  if (!shown || version === null || content === null) {
    return null;
  }
  return (
    <ReleaseWidgetCard
      version={version}
      content={content}
      onOpenNotes={() => {
        recordTelemetryEvent({
          name: "release_widget_action",
          properties: { release_version: version, action: "open_notes" },
        });
        viewReleaseNotes(version, "widget");
        setDismissedVersion(version);
      }}
      onDismiss={() => {
        recordTelemetryEvent({
          name: "release_widget_action",
          properties: { release_version: version, action: "dismiss" },
        });
        setDismissedVersion(version);
      }}
    />
  );
}

interface ReleaseWidgetCardProps {
  version: string;
  content: ReleaseWidgetContent;
  onOpenNotes: () => void;
  onDismiss: () => void;
}

function ReleaseWidgetCard({
  version,
  content,
  onOpenNotes,
  onDismiss,
}: ReleaseWidgetCardProps) {
  const headingId = useId();
  return (
    <article
      data-release-widget
      data-testid="sidebar-release-widget"
      aria-labelledby={headingId}
      className="relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground"
    >
      <ReleaseWidgetHero version={version} image={content.image} />
      <div className="flex min-w-0 flex-col gap-1.5 p-2.5">
        <h2 id={headingId} className="truncate text-sm font-semibold">
          bb {version} is available
        </h2>
        <ul className="flex min-w-0 flex-col gap-0.5">
          {content.highlights.map((highlight) => (
            <li
              key={highlight}
              className="flex min-w-0 items-center gap-2 text-xs"
            >
              <span
                aria-hidden
                className="size-1 shrink-0 rounded-full bg-muted-foreground"
              />
              <span className="truncate">{highlight}</span>
            </li>
          ))}
        </ul>
        <a
          href={getReleaseNotesUrl(version)}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "flex w-fit cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-sidebar-foreground underline decoration-sidebar-border underline-offset-4 outline-none",
            "transition-colors hover:decoration-current focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          )}
          onClick={(event) => {
            event.preventDefault();
            onOpenNotes();
          }}
        >
          Read the release notes
          <Icon name="ExternalLink" className="size-3" aria-hidden />
        </a>
      </div>
      <button
        type="button"
        aria-label={`Dismiss the bb ${version} release preview`}
        className={cn(
          "absolute top-1.5 right-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white outline-none backdrop-blur-sm",
          "transition-colors hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        )}
        onClick={onDismiss}
      >
        <Icon name="X" className="size-3" aria-hidden />
      </button>
    </article>
  );
}

function ReleaseWidgetHero({
  version,
  image,
}: {
  version: string;
  image: ReleaseWidgetImage | null;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = image !== null && failedSrc !== image.src;
  return (
    <span className="relative block aspect-[7/2] w-full shrink-0 overflow-hidden border-b border-sidebar-border bg-sidebar">
      {showImage ? (
        <img
          data-testid="sidebar-release-widget-image"
          src={image.src}
          alt={image.alt}
          loading="lazy"
          decoding="async"
          className="size-full object-cover object-top"
          onError={() => setFailedSrc(image.src)}
        />
      ) : (
        <span
          data-testid="sidebar-release-widget-fallback"
          aria-hidden
          className="flex size-full items-center justify-center gap-2 bg-linear-to-br from-sidebar-accent via-sidebar to-sidebar-accent"
        >
          <BbLogo className="size-7" />
          <span className="text-xl font-semibold tracking-tight tabular-nums">
            {version}
          </span>
        </span>
      )}
    </span>
  );
}

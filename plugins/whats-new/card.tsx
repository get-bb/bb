import { useEffect, useRef, useState, type FocusEvent } from "react";
import { Icon } from "@/components/ui/icon";
import { InlineConfirmation } from "@/components/ui/inline-confirmation";
import { SidebarNudge } from "@/components/ui/sidebar-nudge";
import { ReleaseVisual } from "./release-visual.js";
import { WHATS_NEW_SECTION_ID } from "./seen.js";
import { UPDATES_ROUTE, type ReleaseNotes } from "./state.js";

export const WHATS_NEW_NOTES_HREF = `${UPDATES_ROUTE}#${WHATS_NEW_SECTION_ID}`;

export const WHATS_NEW_CONFIRMATION_MS = 8_000;

const QUIET_LINK_CLASS =
  "cursor-pointer text-xs font-medium text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring";

function ReleaseTile({ release }: { release: ReleaseNotes }) {
  return release.visual === null ? (
    <Icon aria-hidden name="News01" className="size-4" />
  ) : (
    <ReleaseVisual visual={release.visual} className="size-7" />
  );
}

export interface WhatsNewCardProps {
  release: ReleaseNotes;
  onOpen(): void;
  onDismiss(): void;
}

export function WhatsNewCard({
  release,
  onOpen,
  onDismiss,
}: WhatsNewCardProps) {
  const { version } = release;
  return (
    <SidebarNudge
      testId="sidebar-whats-new"
      icon={<ReleaseTile release={release} />}
      dismissLabel={`Dismiss what's new in bb ${version}`}
      onDismiss={onDismiss}
      action={{ label: "See what’s new", onAction: onOpen }}
    >
      bb {version}: {release.headline ?? "see what changed in this release."}
    </SidebarNudge>
  );
}

export type WhatsNewConfirmation = "hidden" | "off";

export interface WhatsNewConfirmationNudgeProps {
  release: ReleaseNotes;
  state: WhatsNewConfirmation;
  settingsHref: string;
  onTurnOff(): void;
  onUndo(): void;
  onClose(): void;
}

function useAutoClose(active: boolean, onClose: () => void) {
  const [paused, setPaused] = useState(false);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!active || paused) return;
    const timer = window.setTimeout(
      () => close.current(),
      WHATS_NEW_CONFIRMATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [active, paused]);
  return {
    onPointerEnter: () => setPaused(true),
    onPointerLeave: () => setPaused(false),
    onFocus: () => setPaused(true),
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
    },
  };
}

export function WhatsNewConfirmationNudge({
  release,
  state,
  settingsHref,
  onTurnOff,
  onUndo,
  onClose,
}: WhatsNewConfirmationNudgeProps) {
  const pauseHandlers = useAutoClose(state === "hidden", onClose);
  return (
    <div {...pauseHandlers}>
      <SidebarNudge
        testId="sidebar-whats-new-confirmation"
        icon={<ReleaseTile release={release} />}
        dismissLabel="Close"
        onDismiss={onClose}
      >
        {state === "hidden" ? (
          <>
            <InlineConfirmation>
              Hidden until the next release
            </InlineConfirmation>
            <span className="mt-1 block">
              <button
                type="button"
                onClick={onTurnOff}
                className={QUIET_LINK_CLASS}
              >
                Turn off What&rsquo;s new
              </button>
            </span>
          </>
        ) : (
          <>
            <InlineConfirmation>What&rsquo;s new is off</InlineConfirmation>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              Turn it back on in{" "}
              <a href={settingsHref} className={QUIET_LINK_CLASS}>
                Settings → Plugins
              </a>
              , or{" "}
              <button
                type="button"
                onClick={onUndo}
                className={QUIET_LINK_CLASS}
              >
                Undo
              </button>
              .
            </span>
          </>
        )}
      </SidebarNudge>
    </div>
  );
}

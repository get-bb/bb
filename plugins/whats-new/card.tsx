import { useId } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { ReleaseVisual } from "./release-visual.js";
import { WHATS_NEW_SECTION_ID } from "./seen.js";
import { UPDATES_ROUTE, type ReleaseNotes } from "./state.js";

const CARD_SURFACE_CLASS =
  "relative rounded-lg bg-card shadow-xs dark:bg-sidebar-accent/50 dark:shadow-none";
const CARD_CONTROL_CLASS =
  "flex size-6 cursor-pointer items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-state-hover hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring data-[state=open]:bg-state-hover motion-reduce:transition-none";

export const WHATS_NEW_NOTES_HREF = `${UPDATES_ROUTE}#${WHATS_NEW_SECTION_ID}`;

export interface WhatsNewCardProps {
  release: ReleaseNotes;
  onOpen(): void;
  onDismiss(): void;
  onTurnOff(): void;
}

export function WhatsNewCard({
  release,
  onOpen,
  onDismiss,
  onTurnOff,
}: WhatsNewCardProps) {
  const labelId = useId();
  const { version } = release;
  return (
    <section
      aria-labelledby={labelId}
      data-testid="sidebar-whats-new"
      data-whats-new-version={version}
      className={`${CARD_SURFACE_CLASS} px-3 pb-2.5 pt-2.5 transition-colors has-[[data-whats-new-open]:hover]:bg-sidebar-accent/40 has-[[data-whats-new-open]:focus-visible]:ring-1 has-[[data-whats-new-open]:focus-visible]:ring-sidebar-ring motion-reduce:transition-none`}
    >
      <p
        id={labelId}
        className="pr-14 text-xs leading-snug text-subtle-foreground"
      >
        What&rsquo;s new · v{version}
      </p>
      <div className="mt-1.5 flex min-w-0 items-start gap-2.5">
        <ReleaseVisual visual={release.visual} className="size-10" />
        <p className="line-clamp-3 min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
          {release.headline ?? `bb ${version}`}
        </p>
      </div>
      <a
        href={WHATS_NEW_NOTES_HREF}
        data-whats-new-open
        aria-label={`See what's new in bb ${version}`}
        onClick={onOpen}
        className="mt-1.5 inline-flex cursor-pointer items-center gap-0.5 text-xs font-medium text-muted-foreground after:absolute after:inset-0 after:rounded-lg after:content-[''] hover:text-foreground focus-visible:outline-none"
      >
        See what&rsquo;s new
        <Icon aria-hidden name="ChevronRight" className="size-3" />
      </a>
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="What's new options"
              className={CARD_CONTROL_CLASS}
            >
              <Icon aria-hidden name="MoreHorizontal" className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" mobileTitle="What's new">
            <DropdownMenuItem onSelect={onTurnOff}>
              Turn off What&rsquo;s new
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={`Dismiss what's new in bb ${version}`}
          onClick={onDismiss}
          className={CARD_CONTROL_CLASS}
        >
          <Icon aria-hidden name="X" className="size-3.5" />
        </button>
      </div>
    </section>
  );
}

export function WhatsNewOffNotice({
  settingsHref,
  onUndo,
  onClose,
}: {
  settingsHref: string;
  onUndo(): void;
  onClose(): void;
}) {
  return (
    <section
      aria-label="What's new is off"
      data-testid="sidebar-whats-new-off"
      className={`${CARD_SURFACE_CLASS} px-3 py-2.5`}
    >
      <p
        role="status"
        className="pr-6 text-xs leading-relaxed text-muted-foreground"
      >
        What&rsquo;s new is off. Turn it back on in{" "}
        <a
          href={settingsHref}
          className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
        >
          Settings → Plugins → What&rsquo;s new
        </a>
        .{" "}
        <button
          type="button"
          onClick={onUndo}
          className="cursor-pointer font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        >
          Undo
        </button>
      </p>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute right-1.5 top-1.5 ${CARD_CONTROL_CLASS}`}
      >
        <Icon aria-hidden name="X" className="size-3.5" />
      </button>
    </section>
  );
}

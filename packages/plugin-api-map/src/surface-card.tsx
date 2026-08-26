/**
 * The product map's annotation card: click a numbered marker and its details
 * open in flow directly below the diagram. Always below, at every width, so
 * the card never covers the region it describes and never moves under the
 * reader between one marker and the next.
 */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Copy01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import { GROUP_BY_SURFACE_ID, type PluginSurface } from "./surfaces";
import {
  annotationChipClass,
  ExperimentalBadge,
  FOCUS_RING_CLASS,
  renderSurfaceCopy,
  type SurfaceReference,
} from "./annotation";
import { pluginIcon, surfaceIcon } from "./plugin-icons";
import { UsedByList } from "./used-by";
import { SurfaceMapContext } from "./wireframes";

export function SurfaceCard({
  surface,
  number,
  onDismiss,
  onCopyForAgent,
  navigation,
  probe = false,
}: {
  surface: PluginSurface;
  /** Marker number, so the card reads as the same annotation. */
  number: number | null;
  onDismiss: () => void;
  onCopyForAgent?: (surface: PluginSurface) => Promise<boolean>;
  /**
   * Render for measurement only (the hidden card-reserve probe): identical
   * box, but no dialog semantics, no global key listener, and no
   * scroll-into-view — a probe must never act like an open card.
   */
  probe?: boolean;
  /** Adjacent annotations on this page; omitted for standalone cards. */
  navigation?: {
    previous: PluginSurface | null;
    next: PluginSurface | null;
    onOpen: (surfaceId: string) => void;
  };
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Null outside a map (the reference sidebar renders cards standalone), and
  // without a resolver the names render as plain text rather than as links
  // that would dead-end on "Plugin not found".
  const surfaceMap = useContext(SurfaceMapContext);
  const pluginPageHref = surfaceMap?.pluginPageHref;
  const icon = surfaceIcon(surface.id);
  const { currentGroupId, onGoToSurface, numberOf } = surfaceMap ?? {};
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");
  const copyResetTimer = useRef<number | null>(null);

  useEffect(() => {
    setCopyState("idle");
    if (copyResetTimer.current !== null) {
      window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = null;
    }
  }, [surface.id]);

  useEffect(
    () => () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
    },
    [],
  );

  const copyForAgent = useCallback(async () => {
    if (!onCopyForAgent || copyState === "copying") return;
    setCopyState("copying");
    const copied = await onCopyForAgent(surface);
    setCopyState(copied ? "copied" : "failed");
    copyResetTimer.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetTimer.current = null;
    }, 2_000);
  }, [copyState, onCopyForAgent, surface]);
  // Cross-references only resolve inside the map: the number and the "which
  // page" answer both come from the carousel. Elsewhere the label is prose.
  const resolveReference = useCallback(
    (id: string): SurfaceReference | null => {
      const group = GROUP_BY_SURFACE_ID.get(id);
      if (!group || !onGoToSurface) return null;
      return {
        number: numberOf?.(id) ?? null,
        otherPage: group.id === currentGroupId ? null : group.title,
        onOpen: () => onGoToSurface(id),
      };
    },
    [currentGroupId, numberOf, onGoToSurface],
  );

  // Dismissal: the close button, Escape, or a click elsewhere within the
  // guide's own UI (ProductMap owns that listener, scoped to the plugin
  // root). Losing focus to the rest of bb — another pane, the sidebar — does
  // not close it, so a card can be read while working beside it. Selecting
  // another marker replaces the card, and panning to another slide closes
  // it, because its marker leaves the screen.
  useEffect(() => {
    if (probe) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss, probe]);

  // The card sits below the diagram, so on a short screen it can open past
  // the fold; bring it into view whenever the open surface changes. Wait
  // out the stage's 300ms re-budget first: the shrink usually brings the
  // card above the fold on its own, and scrolling during the glide layers
  // a second motion on top of it — jump down to the still-unshrunken
  // layout, then clamp back up as the page shortens. After settle,
  // "nearest" is a no-op unless the card is still genuinely out of view.
  useEffect(() => {
    if (probe) return;
    const timer = window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [surface.id, probe]);

  return (
    <div
      ref={cardRef}
      role={probe ? undefined : "dialog"}
      aria-label={probe ? undefined : surface.title}
      className="w-full rounded-lg border border-border bg-popover p-3.5 shadow-lg"
    >
      <div className="flex items-start gap-2">
        {/* A numbered surface is identified by its marker; a pixel-less one
            has no marker, so it carries the same capability glyph its card on
            the "Plugin backend" slide was clicked from. */}
        {number === null ? (
          icon ? (
            <HugeiconsIcon
              icon={icon}
              className="mt-0.5 size-4 shrink-0 text-file-accent"
            />
          ) : null
        ) : (
          <span aria-hidden className={annotationChipClass(true, "mt-0.5")}>
            {number}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-medium text-foreground">
              {surface.title}
            </h3>
            {surface.experimental ? <ExperimentalBadge /> : null}
          </div>
        </div>
        <div className="-mr-1 -mt-1 flex shrink-0 items-center gap-0.5">
          {navigation ? (
            <div
              role="group"
              aria-label="Annotation navigation"
              className="flex items-center gap-0.5"
            >
              {(
                [
                  ["previous", navigation.previous, ArrowLeft01Icon],
                  ["next", navigation.next, ArrowRight01Icon],
                ] as const
              ).map(([direction, target, arrowIcon]) => {
                const directionLabel =
                  direction === "previous" ? "Previous" : "Next";
                const label = target
                  ? `${directionLabel} annotation: ${target.title}`
                  : `No ${direction} annotation`;
                return (
                  <button
                    key={direction}
                    type="button"
                    onClick={() => {
                      if (target) navigation.onOpen(target.id);
                    }}
                    disabled={!target}
                    aria-label={label}
                    title={label}
                    className={`inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground ${FOCUS_RING_CLASS}`}
                  >
                    <HugeiconsIcon icon={arrowIcon} className="size-3.5" />
                  </button>
                );
              })}
            </div>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            title="Close annotation"
            className={`inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground ${FOCUS_RING_CLASS}`}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
          </button>
        </div>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {renderSurfaceCopy(surface.summary, resolveReference)}
      </p>
      <ul className="mt-1.5 list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-muted-foreground marker:text-subtle-foreground">
        {surface.bullets.map((bullet) => (
          <li key={bullet}>{renderSurfaceCopy(bullet, resolveReference)}</li>
        ))}
      </ul>

      {(surface.firstParty && surface.firstParty.length > 0) ||
      onCopyForAgent ? (
        // A footnote, not a second subject: the label recedes to an eyebrow
        // above the border so the surface copy stays the card's content.
        <div className="mt-3 flex min-w-0 items-center gap-x-2 border-t border-border-hairline pt-2.5">
          {/* Inline lead-in, not a stacked heading: the label shares the
              first baseline with the list, which keeps to one line and
              drifts when it outgrows the row. */}
          {/* A subtle pill: the recessed tint alone, no border and no extra
              weight, so the label sits under the names it introduces. */}
          {surface.firstParty && surface.firstParty.length > 0 ? (
            <>
              <span className="shrink-0 rounded bg-surface-recessed px-2 py-0.5 text-xs font-normal text-subtle-foreground">
                Used by
              </span>
              <UsedByList
                items={surface.firstParty}
                renderItem={(plugin) => {
                  const icon = pluginIcon(plugin);
                  const href = pluginPageHref?.(plugin) ?? null;
                  const body = (
                    <>
                      {icon ? (
                        <HugeiconsIcon
                          icon={icon}
                          className="size-3.5 shrink-0 text-subtle-foreground"
                        />
                      ) : null}
                      {plugin}
                    </>
                  );
                  return href ? (
                    <a
                      href={href}
                      // A plain anchor. Inside bb the host opens a plugin's page
                      // beside the guide on any click; anywhere else it is an
                      // ordinary link.
                      className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground"
                    >
                      {body}
                    </a>
                  ) : (
                    <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                      {body}
                    </span>
                  );
                }}
              />
            </>
          ) : null}
          {onCopyForAgent ? (
            <button
              type="button"
              onClick={() => void copyForAgent()}
              disabled={copyState === "copying"}
              className={`ml-auto inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:cursor-wait disabled:opacity-60 ${FOCUS_RING_CLASS}`}
            >
              <HugeiconsIcon
                icon={copyState === "copied" ? Tick02Icon : Copy01Icon}
                className="size-3.5"
              />
              <span aria-live="polite">
                {copyState === "copying"
                  ? "Copying…"
                  : copyState === "copied"
                    ? "Copied"
                    : copyState === "failed"
                      ? "Copy failed"
                      : "Copy for agent"}
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Tracks which surface's card is open. */
export function useSurfaceCard() {
  const [openId, setOpenId] = useState<string | null>(null);
  return {
    openId,
    open: (id: string) => setOpenId(id),
    close: () => setOpenId(null),
  };
}

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { HugeiconsIcon } from "@hugeicons/react";

import { GROUP_BY_SURFACE_ID, type PluginSurface } from "./surfaces";
import {
  annotationChipClass,
  ExperimentalBadge,
  FOCUS_RING_CLASS,
  renderSurfaceCopy,
  type SurfaceReference,
} from "./annotation";
import { pluginIcon, surfaceIcon } from "./plugin-icons";
import { UsedByList, UsedByPager } from "./used-by";
import { SurfaceMapContext } from "./wireframes";

export function SurfaceCard({
  surface,
  number,
  onDismiss,
  onCopyForAgent,
  navigation,
  probe = false,
  mobile = false,
}: {
  surface: PluginSurface;
  number: number | null;
  onDismiss: () => void;
  onCopyForAgent?: (surface: PluginSurface) => Promise<boolean>;
  probe?: boolean;
  mobile?: boolean;
  navigation?: {
    previous: PluginSurface | null;
    next: PluginSurface | null;
    onOpen: (surfaceId: string) => void;
  };
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const ExampleList = mobile ? UsedByPager : UsedByList;
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

  useEffect(() => {
    if (probe) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss, probe]);

  useEffect(() => {
    if (probe) return;
    const timer = window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [probe]);

  return (
    <div
      ref={cardRef}
      role={probe ? undefined : "dialog"}
      aria-label={probe ? undefined : surface.title}
      className="w-full rounded-lg border border-border bg-popover p-3.5 shadow-lg [overflow-wrap:anywhere]"
    >
      <div className="flex items-start gap-2">
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
                  ["previous", navigation.previous, "ChevronLeft"],
                  ["next", navigation.next, "ChevronRight"],
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
                    className={`inline-flex size-9 @2xl/guide:size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground ${FOCUS_RING_CLASS}`}
                  >
                    <Icon name={arrowIcon} className="size-3.5" />
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
            className={`inline-flex size-9 @2xl/guide:size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground ${FOCUS_RING_CLASS}`}
          >
            <Icon name="X" className="size-3.5" />
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
        <div className="mt-3 flex min-w-0 items-center gap-2 border-t border-border-hairline pt-2.5">
          {surface.firstParty && surface.firstParty.length > 0 ? (
            <div className={`flex min-w-0 flex-1 items-center ${mobile ? "gap-1" : "gap-2"}`}>
              <span className={`shrink-0 whitespace-nowrap text-xs text-subtle-foreground ${mobile ? "" : "rounded bg-surface-recessed px-2 py-0.5 font-normal"}`}>
                Used by
              </span>
              <ExampleList
                key={surface.id}
                items={surface.firstParty}
                renderItem={(plugin) => {
                  const icon = pluginIcon(plugin);
                  const href = pluginPageHref?.(plugin) ?? null;
                  const body = (
                    <>
                      {surfaceMap?.renderPluginIcon?.(plugin) ??
                        (icon ? (
                          <Icon
                            name={icon}
                            className="size-3.5 shrink-0 text-subtle-foreground"
                          />
                        ) : null)}
                      {mobile ? <span className="min-w-0 truncate">{plugin}</span> : plugin}
                    </>
                  );
                  return href ? (
                    <a
                      href={href}
                      title={plugin}
                      className={mobile
                        ? `flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-surface-recessed px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground ${FOCUS_RING_CLASS}`
                        : "flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground"}
                    >
                      {body}
                    </a>
                  ) : (
                    <span className={mobile
                      ? "flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-surface-recessed px-2 py-1 text-xs text-muted-foreground"
                      : "flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground"}>
                      {body}
                    </span>
                  );
                }}
              />
            </div>
          ) : null}
          {onCopyForAgent ? (
            <button
              type="button"
              onClick={() => void copyForAgent()}
              disabled={copyState === "copying"}
              aria-label={copyState === "failed" ? "Copy failed. Retry copy for agent" : "Copy for agent"}
              title={copyState === "failed" ? "Copy failed. Retry copy for agent" : "Copy for agent"}
              className={`ml-auto inline-flex shrink-0 cursor-pointer items-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:cursor-wait disabled:opacity-60 ${mobile ? "size-9 @2xl/guide:size-7 justify-center" : "h-7 gap-1.5 whitespace-nowrap px-2 text-xs font-medium"} ${FOCUS_RING_CLASS}`}
            >
              <Icon
                name={copyState === "copied" ? "Check" : copyState === "failed" ? "AlertCircle" : "Copy"}
                className="size-3.5"
              />
              <span className={mobile ? "sr-only" : undefined} aria-live="polite">
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

export function useSurfaceCard() {
  const [openId, setOpenId] = useState<string | null>(null);
  return {
    openId,
    open: (id: string) => setOpenId(id),
    close: () => setOpenId(null),
  };
}

import { type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

/**
 * A detail-row label with a leading icon, styled like the timeline's tool-call
 * leading icons (`size-3.5 text-muted-foreground`). Shared so detail surfaces
 * (the thread info panel, the git-action dialog) render the same row labels
 * consistently.
 */
export function DetailRowIconLabel({
  icon,
  children,
}: {
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon name={icon} className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/**
 * The label/value column grid shared by every detail row. Exported so loading
 * skeletons can align their placeholder bars to real rows without re-typing
 * (and silently drifting from) the column template.
 */
export const DETAIL_GRID_CLASS =
  "grid grid-cols-[var(--detail-label-width,96px)_minmax(0,1fr)] gap-x-3";
const DETAIL_LABEL_CLASS = "m-0 text-xs leading-5 text-muted-foreground";
const DETAIL_VALUE_CLASS = "m-0 min-w-0 text-xs leading-5 text-foreground";

type DetailRowOrientation = "horizontal" | "vertical";

function labelWidthStyle(
  labelWidth: string | undefined,
): CSSProperties | undefined {
  if (!labelWidth) {
    return undefined;
  }
  return { "--detail-label-width": labelWidth } as CSSProperties;
}

export type DetailCardAppearance = "card" | "flat";

export interface DetailCardProps {
  children: ReactNode;
  className?: string;
  /**
   * Width of the label column. Applied as a CSS custom property so descendant
   * rows inherit it without prop drilling. Defaults to 96px.
   */
  labelWidth?: string;
  /**
   * `card` (default) wraps the rows in a bordered, padded panel.
   * `flat` drops the chrome so the rows sit inline with surrounding content
   * — useful inside modals or other containers that already provide framing.
   */
  appearance?: DetailCardAppearance;
}

const DETAIL_CARD_BASE_CLASS = "flex flex-col gap-1";
const DETAIL_CARD_CARD_CLASS =
  "rounded-md border border-border bg-surface-raised px-2 py-1";

export function DetailCard({
  children,
  className,
  labelWidth,
  appearance = "card",
}: DetailCardProps) {
  return (
    <dl
      className={cn(
        DETAIL_CARD_BASE_CLASS,
        appearance === "card" && DETAIL_CARD_CARD_CLASS,
        className,
      )}
      style={labelWidthStyle(labelWidth)}
    >
      {children}
    </dl>
  );
}

export interface DetailRowProps {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
  align?: "start" | "center";
  /**
   * `horizontal` (default): label sits left of the value in the shared label column.
   * `vertical`: label sits above the value. Use for wide/tall content like lists.
   */
  orientation?: DetailRowOrientation;
}

export function DetailRow({
  label,
  children,
  className,
  labelClassName,
  valueClassName,
  align = "center",
  orientation = "horizontal",
}: DetailRowProps) {
  if (orientation === "vertical") {
    return (
      <div className={cn("flex flex-col gap-1 py-0.5", className)}>
        <dt className={cn(DETAIL_LABEL_CLASS, labelClassName)}>{label}</dt>
        <dd className={cn(DETAIL_VALUE_CLASS, valueClassName)}>{children}</dd>
      </div>
    );
  }

  return (
    <div
      className={cn(
        DETAIL_GRID_CLASS,
        align === "center" ? "items-center py-0.5" : "py-0.5",
        className,
      )}
    >
      <dt className={cn(DETAIL_LABEL_CLASS, labelClassName)}>{label}</dt>
      <dd className={cn(DETAIL_VALUE_CLASS, valueClassName)}>{children}</dd>
    </div>
  );
}

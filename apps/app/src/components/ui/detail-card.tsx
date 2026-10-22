import { type CSSProperties, type ReactNode, type UIEventHandler } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

export const DETAIL_ROW_ICON_CLASS =
  "size-3 shrink-0 text-subtle-foreground max-md:pointer-coarse:size-4";

function DetailRowIconLabel({
  icon,
  children,
}: {
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon name={icon} className={DETAIL_ROW_ICON_CLASS} />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export const DETAIL_GRID_CLASS =
  "grid grid-cols-[var(--detail-label-width,96px)_minmax(0,1fr)] gap-x-3";
export const DETAIL_LABEL_CLASS = "m-0 text-xs leading-5 text-muted-foreground";
export const DETAIL_VALUE_CLASS =
  "m-0 min-w-0 text-xs leading-5 text-foreground";

function labelWidthStyle(
  labelWidth: string | undefined,
): CSSProperties | undefined {
  if (!labelWidth) {
    return undefined;
  }
  return { "--detail-label-width": labelWidth } as CSSProperties;
}

type DetailCardAppearance = "card" | "flat";

interface DetailCardProps {
  children: ReactNode;
  className?: string;
  onScroll?: UIEventHandler<HTMLDListElement>;
  labelWidth?: string;
  appearance?: DetailCardAppearance;
}

const DETAIL_CARD_BASE_CLASS = "flex flex-col gap-1";
const DETAIL_CARD_CARD_CLASS =
  "rounded-md border border-border bg-surface-raised px-2 py-1";

export function DetailCard({
  children,
  className,
  onScroll,
  labelWidth,
  appearance = "card",
}: DetailCardProps) {
  return (
    <dl
      onScroll={onScroll}
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

interface DetailRowProps {
  label: ReactNode;
  icon?: IconName;
  align?: "start" | "center";
  children: ReactNode;
}

export function DetailRow({
  label,
  icon,
  align = "center",
  children,
}: DetailRowProps) {
  return (
    <div
      className={cn(
        DETAIL_GRID_CLASS,
        align === "center" ? "items-center py-0.5" : "py-0.5",
      )}
    >
      <dt className={DETAIL_LABEL_CLASS}>
        {icon === undefined ? (
          label
        ) : (
          <DetailRowIconLabel icon={icon}>{label}</DetailRowIconLabel>
        )}
      </dt>
      <dd className={DETAIL_VALUE_CLASS}>{children}</dd>
    </div>
  );
}

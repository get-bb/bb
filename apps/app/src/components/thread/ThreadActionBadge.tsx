import type {
  ExperimentalBadge,
  ExperimentalBadgeTone,
} from "@get-bb/plugin-sdk";
import { cn } from "@bb/shared-ui/lib/utils";

const MAX_DRAWN_COUNT = 99;

const TONE_CLASS: Record<ExperimentalBadgeTone, string> = {
  neutral: "bg-muted-foreground text-background",
  warning: "bg-attention text-attention-foreground",
  critical: "bg-destructive text-destructive-foreground",
};

export function threadActionAccessibleName(action: {
  label: string;
  badge?: ExperimentalBadge;
}): string {
  return action.badge === undefined
    ? action.label
    : `${action.label}, ${action.badge.label}`;
}

export function ThreadActionBadgeMark({
  badge,
  className,
}: {
  badge: ExperimentalBadge;
  className?: string;
}) {
  const tone = badge.tone ?? "neutral";
  const value =
    badge.count !== undefined
      ? badge.count > MAX_DRAWN_COUNT
        ? `${MAX_DRAWN_COUNT}+`
        : String(badge.count)
      : (badge.text ?? null);
  return (
    <span
      aria-hidden="true"
      data-thread-action-badge={
        value === null ? "dot" : badge.count !== undefined ? "count" : "text"
      }
      data-thread-action-badge-tone={tone}
      className={cn("flex shrink-0", className)}
    >
      {value === null ? (
        <span className={cn("block size-1.5 rounded-full", TONE_CLASS[tone])} />
      ) : (
        <span
          className={cn(
            "flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 text-2xs leading-none font-semibold whitespace-nowrap tabular-nums",
            TONE_CLASS[tone],
          )}
        >
          {value}
        </span>
      )}
    </span>
  );
}

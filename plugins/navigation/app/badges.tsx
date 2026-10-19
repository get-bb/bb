import type {
  ExperimentalBadge,
  ExperimentalBadgeTone,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";

const RAIL_MAX_DRAWN_COUNT = 9;
const LIST_MAX_DRAWN_COUNT = 99;

export function navigationBadgeAccessibleLabel(
  label: string,
  badge: ExperimentalBadge | null,
): string {
  return badge === null ? label : `${label}, ${badge.label}`;
}

export function hiddenNavigationBadgeLabels(
  hidden: readonly { label: string; badge: ExperimentalBadge | null }[],
): string[] {
  return hidden.flatMap((item) =>
    item.badge ? [`${item.label}: ${item.badge.label}`] : [],
  );
}

const TONE_RANK: Record<ExperimentalBadgeTone, number> = {
  neutral: 0,
  warning: 1,
  critical: 2,
};

export function strongestNavigationBadgeTone(
  badges: readonly (ExperimentalBadge | null)[],
): ExperimentalBadgeTone | null {
  let strongest: ExperimentalBadgeTone | null = null;
  for (const badge of badges) {
    if (badge === null) continue;
    const tone = badge.tone ?? "neutral";
    if (strongest === null || TONE_RANK[tone] > TONE_RANK[strongest]) {
      strongest = tone;
    }
  }
  return strongest;
}

const TONE_CLASS: Record<ExperimentalBadgeTone, string> = {
  neutral: "bg-muted-foreground text-background",
  warning: "bg-attention text-attention-foreground",
  critical: "bg-destructive text-destructive-foreground",
};

const RAIL_CUTOUT_CLASS =
  "rounded-full bg-sidebar bg-[linear-gradient(var(--surface-recessed),var(--surface-recessed))] p-[1.5px]";

export function NavigationBadgeMark({
  badge,
  size = "rail",
  className,
}: {
  badge: Pick<ExperimentalBadge, "count" | "text" | "tone">;
  size?: "rail" | "list";
  className?: string;
}) {
  const tone = badge.tone ?? "neutral";
  const max = size === "rail" ? RAIL_MAX_DRAWN_COUNT : LIST_MAX_DRAWN_COUNT;
  const value =
    badge.count !== undefined
      ? badge.count > max
        ? `${max}+`
        : String(badge.count)
      : size === "list"
        ? (badge.text ?? null)
        : null;
  const kind =
    value === null ? "dot" : badge.count !== undefined ? "count" : "text";
  const mark =
    value === null ? (
      <span
        className={cn(
          "block rounded-full",
          size === "rail" ? "size-2" : "size-1.5",
          TONE_CLASS[tone],
        )}
      />
    ) : (
      <span
        className={cn(
          "flex items-center justify-center rounded-full font-semibold leading-none tabular-nums whitespace-nowrap text-2xs",
          size === "rail" ? "h-3.5 min-w-3.5 px-1" : "h-4 min-w-4 px-1.5",
          TONE_CLASS[tone],
        )}
      >
        {value}
      </span>
    );
  return (
    <span
      aria-hidden="true"
      data-nav-rail-badge={kind}
      data-nav-badge-tone={tone}
      className={cn(
        "flex shrink-0",
        size === "rail" && RAIL_CUTOUT_CLASS,
        className,
      )}
    >
      {mark}
    </span>
  );
}

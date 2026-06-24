import { cn } from "@/lib/utils";

export type ActivityRowState =
  | "active"
  | "pending"
  | "completed"
  | "failed"
  | "muted";

const ACTIVITY_ROW_CLASS: Record<ActivityRowState, string> = {
  active:
    "rounded-md bg-background/70 px-2 py-1 shadow-xs ring-1 ring-border/60",
  pending: "rounded-md px-2 py-0.5",
  completed: "rounded-md px-2 py-0.5",
  failed:
    "rounded-md bg-destructive/5 px-2 py-1 ring-1 ring-destructive/20",
  muted: "rounded-md px-2 py-0.5 opacity-60",
};

const ACTIVITY_ICON_CLASS: Record<ActivityRowState, string> = {
  active: "animate-shine-icon text-foreground",
  pending: "text-muted-foreground/45",
  completed: "text-subtle-foreground",
  failed: "text-destructive-text",
  muted: "text-subtle-foreground",
};

const ACTIVITY_TEXT_CLASS: Record<ActivityRowState, string> = {
  active: "animate-shine font-medium text-foreground",
  pending: "text-muted-foreground",
  completed:
    "text-subtle-foreground line-through decoration-subtle-foreground/70",
  failed: "text-destructive-text",
  muted: "text-subtle-foreground",
};

const ACTIVITY_META_CLASS: Record<ActivityRowState, string> = {
  active: "text-muted-foreground",
  pending: "text-subtle-foreground",
  completed: "text-subtle-foreground",
  failed: "text-destructive-text",
  muted: "text-subtle-foreground",
};

export function activityRowClass(
  state: ActivityRowState,
  className?: string,
): string {
  return cn(ACTIVITY_ROW_CLASS[state], className);
}

export function activityIconClass(
  state: ActivityRowState,
  className?: string,
): string {
  return cn(ACTIVITY_ICON_CLASS[state], className);
}

export function activityTextClass(
  state: ActivityRowState,
  className?: string,
): string {
  return cn(ACTIVITY_TEXT_CLASS[state], className);
}

export function activityMetaClass(
  state: ActivityRowState,
  className?: string,
): string {
  return cn(ACTIVITY_META_CLASS[state], className);
}

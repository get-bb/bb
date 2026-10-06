const UPDATE_STATES = [
  "up-to-date",
  "in-progress",
  "update-available",
  "restart-required",
  "not-installed",
  "update-manually",
  "latest-unknown",
  "failed",
  "offline",
] as const;

export type UpdateState = (typeof UPDATE_STATES)[number];

type UpdateStateTone = "muted" | "error";

interface UpdateStatePresentation {
  icon: string | null;
  label: string;
  tone: UpdateStateTone;
  inFlight?: boolean;
}

export const RETRY_ACTION_ICON = "RotateCcw";

export const UPDATE_ACTION_ICON = "Download";

export const UPDATE_STATE_PRESENTATION: Record<
  UpdateState,
  UpdateStatePresentation
> = {
  "up-to-date": {
    icon: "CircleCheck",
    label: "Up to date",
    tone: "muted",
  },
  "in-progress": {
    icon: "Loading",
    label: "In progress",
    tone: "muted",
    inFlight: true,
  },
  "update-available": {
    icon: UPDATE_ACTION_ICON,
    label: "Update available",
    tone: "muted",
  },
  "restart-required": {
    icon: "ArrowReloadHorizontal",
    label: "Downloaded",
    tone: "muted",
  },
  "not-installed": { icon: "Download", label: "Not installed", tone: "muted" },
  "update-manually": {
    icon: "Terminal",
    label: "Update in terminal",
    tone: "muted",
  },
  "latest-unknown": {
    icon: "CircleQuestion",
    label: "Latest unknown",
    tone: "muted",
  },
  failed: {
    icon: "CircleX",
    label: "Failed",
    tone: "error",
  },
  offline: { icon: "CircleX", label: "Offline", tone: "muted" },
};

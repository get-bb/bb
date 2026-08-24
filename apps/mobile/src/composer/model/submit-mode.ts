import type { FollowUpSubmitMode } from "@bb/client-core";

/**
 * What the submit button does and shows for one composer state. The thread
 * screen passes the client-core `FollowUpSubmitMode`; the new-thread screen
 * passes the literal `"ready"`.
 */
export type ComposerSubmitMode = FollowUpSubmitMode | "ready";

export type ComposerSubmitKind = "send" | "queue" | "steer";

export interface SubmitAffordance {
  /** Primary button action, or `null` when nothing can be submitted. */
  kind: ComposerSubmitKind | null;
  icon: "ArrowUp" | "Plus" | "Square" | "Spinner";
  /** Accessibility label / tooltip. */
  label: string;
  /** Button is rendered but inert (blocked, submitting, nothing to send). */
  disabled: boolean;
  /** A stop button sits next to (or instead of) submit. */
  stop: (() => void) | null;
  /** Long-press sends as an explicit steer (web: Cmd+Enter while active). */
  longPressSteer: boolean;
}

export interface DescribeSubmitModeArgs {
  mode: ComposerSubmitMode;
  hasInput: boolean;
  isSubmitting: boolean;
  disabled: boolean;
  /** Custom label for the ready state ("Create", "Send"). */
  readyLabel?: string;
}

/** Web `FollowUpPromptBox` title mapping for blocked reasons. */
function describeSubmitMode(mode: ComposerSubmitMode): string {
  if (mode === "ready" || mode.kind === "ready") return "Send";
  if (mode.kind === "queue") return "Queue follow-up";
  if (mode.kind === "stop-only") return "Stop";
  switch (mode.reason) {
    case "stopping":
      return "Stopping run…";
    case "loading-execution-options":
      return "Loading models…";
    case "loading-pending-interactions":
      return "Checking pending interactions…";
    case "pending-interaction":
      return "Answer the pending request first";
    case "provisioning":
      return "Provisioning…";
    case "unavailable":
      return "Unavailable";
  }
}

export function resolveSubmitAffordance({
  mode,
  hasInput,
  isSubmitting,
  disabled,
  readyLabel = "Send",
}: DescribeSubmitModeArgs): SubmitAffordance {
  const normalized: FollowUpSubmitMode =
    mode === "ready" ? { kind: "ready" } : mode;
  const stop =
    normalized.kind === "queue" || normalized.kind === "stop-only"
      ? normalized.onStop
      : null;
  if (isSubmitting) {
    return {
      kind: null,
      icon: "Spinner",
      label: "Submitting…",
      disabled: true,
      stop,
      longPressSteer: false,
    };
  }
  switch (normalized.kind) {
    case "ready":
      return {
        kind: "send",
        icon: "ArrowUp",
        label: readyLabel,
        disabled: disabled || !hasInput,
        stop: null,
        longPressSteer: false,
      };
    case "queue":
      return {
        kind: "queue",
        icon: "Plus",
        label: "Queue follow-up",
        disabled: disabled || !hasInput,
        stop,
        longPressSteer: true,
      };
    case "stop-only":
      return {
        kind: null,
        icon: "Square",
        label: "Stop",
        disabled: true,
        stop,
        longPressSteer: false,
      };
    case "blocked":
      return {
        kind: null,
        icon: normalized.reason === "unavailable" ? "ArrowUp" : "Spinner",
        label: describeSubmitMode(normalized),
        disabled: true,
        stop: null,
        longPressSteer: false,
      };
  }
}

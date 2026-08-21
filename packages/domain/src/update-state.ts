/**
 * One vocabulary for "how is this piece of work going", shared by every
 * surface that reports on background work: Settings → Updates, `bb updates`,
 * and the Automations run history. One map to maintain, so a mark learned in
 * one part of bb cannot mean something else in another.
 *
 * Icon names are `@bb/shared-ui` icon keys kept as plain strings, so this
 * module stays framework-free and the CLI can import it.
 */

/**
 * The generic lifecycle every kind of run shares. Automations' run statuses
 * and the Updates states both draw from this core rather than keeping their
 * own copies of the same three glyphs.
 */
export const RUN_STATE_PRESENTATION = {
  "in-progress": { icon: "Loading", label: "In progress", inFlight: true },
  succeeded: { icon: "CircleCheck", label: "Succeeded", inFlight: false },
  failed: { icon: "CircleX", label: "Failed", inFlight: false },
  // Not CircleDashed: icon.tsx aliases it to the same DashedLineCircleIcon as
  // Spinner, so a passed-over item would draw the identical shape to a
  // running one. ArrowTurnForward is the one glyph that reads as "skipped"
  // and is shape-distinct from check, cross and spinner.
  skipped: { icon: "ArrowTurnForward", label: "Skipped", inFlight: false },
} as const satisfies Record<
  string,
  { icon: string; label: string; inFlight: boolean }
>;

/** The update-specific ladder. */
const UPDATE_STATES = [
  "up-to-date",
  "in-progress",
  "update-available",
  "restart-required",
  "not-installed",
  "update-manually",
  "failed",
  "offline",
] as const;

export type UpdateState = (typeof UPDATE_STATES)[number];

/**
 * Colour is the page's scarcest signal, so there are exactly two tones: muted
 * for everything the reader has no decision to make about, error for a
 * failure. Nothing here is orange — a state either failed or it did not.
 */
type UpdateStateTone = "muted" | "error";

interface UpdateStatePresentation {
  /** `@bb/shared-ui` icon key, or null when the state is text-only. */
  icon: string | null;
  /** The sentence a UI puts on hover and the CLI prints in its State column. */
  label: string;
  tone: UpdateStateTone;
  /** Spin the mark: the state is work in flight, not a resting condition. */
  inFlight?: boolean;
}

/**
 * The glyph a retryable failure's control wears. The control is neutral: the
 * caption beside it already states the failure, so colouring the button too
 * would say it twice and make a recovery action read as another error.
 */
export const RETRY_ACTION_ICON = "RotateCcw";

/** The established glyph for an action that fetches an available update. */
export const UPDATE_ACTION_ICON = "Download";

export const UPDATE_STATE_PRESENTATION: Record<
  UpdateState,
  UpdateStatePresentation
> = {
  // The shared succeeded glyph, but muted: being current is the state every
  // row is expected to be in, and colour is spent on exceptions.
  "up-to-date": {
    icon: RUN_STATE_PRESENTATION.succeeded.icon,
    label: "Up to date",
    tone: "muted",
  },
  // The shared running indicator, verbatim. Covers checking, downloading, a
  // daemon updating itself and a CLI installing — one condition, four names.
  "in-progress": {
    icon: RUN_STATE_PRESENTATION["in-progress"].icon,
    label: "In progress",
    tone: "muted",
    inFlight: true,
  },
  // The sidebar update chip's own mark: something is there to fetch.
  "update-available": {
    icon: UPDATE_ACTION_ICON,
    label: "Update available",
    tone: "muted",
  },
  // The desktop relaunch control's own glyph, worn inside its button.
  "restart-required": {
    icon: "ArrowReloadHorizontal",
    label: "Downloaded",
    tone: "muted",
  },
  "not-installed": { icon: "Download", label: "Not installed", tone: "muted" },
  // Real state, quiet tone: the CLI was installed outside bb (Homebrew, a
  // manual npm -g), so bb can see a newer release but has no installer to
  // run. Informational, not a warning — nothing is wrong.
  // bb has no installer it can run for this CLI, so the row points at where
  // the work happens instead of offering a control that would do nothing.
  "update-manually": {
    icon: "Terminal",
    label: "Update in terminal",
    tone: "muted",
  },
  failed: {
    icon: RUN_STATE_PRESENTATION.failed.icon,
    label: "Failed",
    tone: "error",
  },
  // Reuse the established closed-state glyph, but keep it muted and label it
  // "Offline" so it cannot be mistaken for the red failure state.
  offline: { icon: "CircleX", label: "Offline", tone: "muted" },
};

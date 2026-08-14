import type { PluginSidebarThreadIndicator } from "@get-bb/plugin-sdk";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";

/**
 * This plugin's status glyphs, matching bb's own sidebar shape for shape: the
 * red circle-x for a failure, the circle-question for a raised hand, the
 * spinner for live work, and a dot for a finished thread you have not read.
 *
 * The SDK ships `indicator` as data and no status component on purpose, so a
 * replaced sidebar can choose its own look. This one deliberately does not:
 * the two lists sit in the same window, and a user who switches between them
 * should not have to learn a second vocabulary.
 *
 * An unrecognized indicator draws nothing: bb adds kinds over time, and a
 * plugin built today must not break on a kind shipped tomorrow.
 */

/**
 * Whether this indicator draws a glyph that speaks for the row.
 *
 * The row gives the glyph and the age ONE slot, so this decides which of the
 * two the user sees. Listed kind by kind rather than "anything but none": an
 * indicator bb ships tomorrow must fall through to the age label, not blank
 * the slot.
 */
export function hasStatusGlyph(
  indicator: PluginSidebarThreadIndicator,
): boolean {
  switch (indicator) {
    case "unread-error":
    case "waiting-for-input":
    case "unread-success":
    case "runtime":
    case "workflow":
    case "background-agent":
    case "background-command":
    case "plan-mode":
    case "goal":
    case "draft":
    case "working-draft":
      return true;
    default:
      return false;
  }
}

export function StatusGlyph({
  indicator,
  label,
  className,
}: {
  indicator: PluginSidebarThreadIndicator;
  label: string | null;
  className?: string;
}) {
  const shared = cn("size-3.5 shrink-0", className);
  const aria = label ?? undefined;

  switch (indicator) {
    case "unread-error":
      return (
        <Icon
          name="CircleX"
          aria-label={aria}
          className={cn(shared, "text-destructive")}
        />
      );
    case "waiting-for-input":
      return (
        <Icon
          name="CircleQuestion"
          aria-label={aria}
          className={cn(shared, "text-muted-foreground/75")}
        />
      );
    case "runtime":
      return (
        <Icon
          name="Loading"
          aria-label={aria}
          className={cn(shared, "animate-spin text-muted-foreground/50")}
        />
      );
    case "workflow":
      return <ShineIcon name="Workflow" label={aria} className={shared} />;
    case "background-agent":
      return <ShineIcon name="UserRoundPlus" label={aria} className={shared} />;
    case "background-command":
      return <ShineIcon name="Terminal" label={aria} className={shared} />;
    case "plan-mode":
      return <ShineIcon name="ListTodo" label={aria} className={shared} />;
    case "goal":
      return <ShineIcon name="Target" label={aria} className={shared} />;
    case "draft":
    case "working-draft":
      return (
        <Icon
          name="Edit"
          aria-label={aria}
          className={cn(shared, "text-muted-foreground")}
        />
      );
    case "unread-success":
      // The notification dot, in a box the size of every other glyph, the way
      // bb centers its own trailing indicators. Right-aligned on its own, a
      // 5px dot would sit ~4px off the column the icons share.
      return (
        <span
          aria-label={aria}
          className={cn("flex items-center justify-center", shared)}
        >
          <span className="size-[5px] rounded-full bg-timeline-accent" />
        </span>
      );
    case "none":
      return null;
    default:
      return null;
  }
}

function ShineIcon({
  name,
  label,
  className,
}: {
  name: "Workflow" | "UserRoundPlus" | "Terminal" | "ListTodo" | "Target";
  label: string | undefined;
  className: string;
}) {
  return (
    <Icon
      name={name}
      aria-label={label}
      className={cn("animate-shine-icon text-muted-foreground/50", className)}
    />
  );
}

import type { PluginSidebarThreadIndicator } from "@bb/plugin-sdk";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

/**
 * This plugin's own status glyphs.
 *
 * The SDK ships `indicator` as data and no status component on purpose, so a
 * replaced sidebar can choose its own look. These follow bb's convention —
 * colour only for an unread failure, everything else neutral — because bb's
 * own restraint is the part worth keeping.
 *
 * An unrecognized indicator draws nothing: bb adds kinds over time, and a
 * plugin built today must not break on a kind shipped tomorrow.
 */
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
        <Icon name="CircleX" aria-label={aria} className={cn(shared, "text-destructive")} />
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
        <Icon name="Edit" aria-label={aria} className={cn(shared, "text-muted-foreground")} />
      );
    case "unread-success":
      return (
        <span
          aria-label={aria}
          className="size-[5px] shrink-0 rounded-full bg-muted-foreground/60"
        />
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

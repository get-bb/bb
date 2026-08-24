import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import type { ShowcaseArchetype } from "./showcase-archetype";
import { accentInk, accentTint, neutral } from "./showcase-tokens";

/**
 * The one example-card shape every tier uses, so grids of different sources
 * still read as one system. Without an accent token the icon chip goes
 * neutral, marking capability-level entries apart from the flagship ideas.
 */
export function ShowcaseExampleCard({
  icon,
  title,
  description,
  accentToken,
  tooltip,
  onClick,
}: {
  icon: ShowcaseArchetype["icon"];
  title: string;
  description: string;
  accentToken?: string;
  /** Full seeded prompt, shown on hover AND keyboard focus (the card view
   * truncates the brief, so this is the only way to read it pre-commit). */
  tooltip?: string;
  onClick: () => void;
}) {
  const card = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex cursor-pointer flex-col items-start gap-1.5 rounded-lg border border-border",
        "bg-background p-3 text-left transition-colors duration-150 hover:duration-0",
        "hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring",
        "focus-visible:outline-none",
      )}
    >
      <div className="flex w-full items-center gap-2">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-md border"
          style={
            accentToken !== undefined
              ? {
                  background: accentTint(accentToken, 14),
                  borderColor: accentTint(accentToken, 40),
                  color: accentInk(accentToken, 62),
                }
              : {
                  background: neutral(5),
                  borderColor: neutral(14),
                  color: neutral(55),
                }
          }
        >
          <Icon name={icon} className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {title}
        </span>
      </div>
      <span className="block min-h-[2lh] text-xs leading-snug text-subtle-foreground">
        {description}
      </span>
    </button>
  );

  if (tooltip === undefined) return card;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

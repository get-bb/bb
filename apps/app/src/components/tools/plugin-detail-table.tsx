import type { ReactNode } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";

/**
 * The one table treatment every plugin-detail section uses.
 *
 * About, Capabilities, Background services and Scheduled jobs are all the same
 * kind of object — a bordered list of rows — so they share a shell rather than
 * each inventing a surface. The shell hugs its contents instead of stretching
 * to the page width, which is what stopped short rows stranding a wide empty
 * gutter.
 */
export function PluginDetailTable({ children }: { children: ReactNode }) {
  return (
    <div className="inline-block max-w-full overflow-hidden rounded-md border border-border align-top">
      <table className="w-auto max-w-full border-collapse text-left">
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </div>
  );
}

const CELL = "px-3 py-2 align-top";

/** A label/value row, for the About block. */
export function PluginDetailFactRow({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <tr>
      <th
        scope="row"
        className={cn(
          CELL,
          "w-[9rem] whitespace-nowrap bg-surface-recessed text-xs font-medium text-muted-foreground",
        )}
      >
        {label}
      </th>
      <td
        className={cn(
          CELL,
          "max-w-[42rem] text-sm text-foreground",
          mono && "font-mono text-xs",
        )}
      >
        {children}
      </td>
    </tr>
  );
}

/**
 * A glyph whose tooltip names what it stands for.
 *
 * The kind is carried by the icon rather than a column: a plugin contributes
 * one or two items in most of its seven kinds, so a Kind column would be
 * near-unique per row and read as filler. Hovering — or focusing — names it.
 */
export function PluginDetailGlyph({
  icon,
  label,
  className,
  spin = false,
}: {
  icon: IconName;
  label: string;
  className?: string;
  spin?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={label}
            tabIndex={0}
            className="inline-flex shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon
              name={icon}
              className={cn("size-4", className, spin && "animate-shine-icon")}
              aria-hidden
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Name plus description, used by Capabilities and both health tables. */
export function PluginDetailRow({
  glyph,
  name,
  mono = false,
  detail,
}: {
  glyph: ReactNode;
  name: ReactNode;
  mono?: boolean;
  detail: ReactNode;
}) {
  // A table of rows that all lack a detail — background services, say — must
  // not reserve an empty second column, or it hangs a strip of dead padding off
  // the right edge of the surface.
  const hasDetail = detail !== null && detail !== undefined && detail !== "";
  return (
    <tr>
      <td
        className={cn(CELL, "max-w-[17rem]")}
        colSpan={hasDetail ? undefined : 2}
      >
        <span className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5">{glyph}</span>
          <span
            className={cn(
              "min-w-0 break-words text-sm leading-snug text-foreground",
              mono && "font-mono",
            )}
          >
            {name}
          </span>
        </span>
      </td>
      {hasDetail ? (
        <td
          className={cn(
            CELL,
            "max-w-[34rem] text-xs leading-relaxed text-muted-foreground",
          )}
        >
          {detail}
        </td>
      ) : null}
    </tr>
  );
}

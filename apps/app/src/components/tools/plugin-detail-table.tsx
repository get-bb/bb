import type { ReactNode } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";

/** Shared first-column grid for every structured plugin detail table. */
export const PLUGIN_DETAIL_PRIMARY_COLUMN_CLASS = "w-40 md:w-48";

/**
 * The table treatment for detail-page rows with a name and richer detail.
 *
 * Capabilities and Scheduled jobs share a shell. The outer edge, row rules,
 * and column divider form one connected grid, so names and descriptions remain
 * easy to scan. Background services use their own labelled Status/Service table
 * because status is a distinct attribute rather than descriptive copy.
 */
export function PluginDetailTable({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-full overflow-hidden rounded-lg border border-border bg-card align-top">
      <table className="w-full max-w-full table-fixed border-collapse text-left">
        <colgroup>
          <col className={PLUGIN_DETAIL_PRIMARY_COLUMN_CLASS} />
          <col />
        </colgroup>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

// Matched to ResourceDetailListItem (detail-shell.tsx:150), the house row
// density. A table cell is still a row; it should not sit looser than one.
//
// The type is pinned here rather than left to the cell's contents: a `td`
// inherits the 16px/24px root leading, and that — not the padding — was what
// made these rows stand 10px taller than every other row in the app.
//
const CELL = "py-1.5 align-top text-sm leading-snug";

/** Label/value rows that use the same connected grid as plugin collections. */
export function PluginDetailFieldRow({
  label,
  children,
  stackOnNarrow = false,
}: {
  label: ReactNode;
  children: ReactNode;
  stackOnNarrow?: boolean;
}) {
  if (stackOnNarrow) {
    return (
      <tr>
        <th
          scope="row"
          colSpan={2}
          aria-label={typeof label === "string" ? label : undefined}
          className="p-0 text-left font-normal"
        >
          <div className="sm:grid sm:grid-cols-[10rem_minmax(0,1fr)] md:grid-cols-[12rem_minmax(0,1fr)]">
            <span
              className={cn(
                CELL,
                "block border-b border-border px-4 text-xs text-muted-foreground sm:border-b-0 sm:border-r sm:pl-4 sm:pr-2",
              )}
            >
              {label}
            </span>
            <div className="px-4 py-3 text-foreground sm:py-1.5 sm:pl-2 sm:pr-4">
              {children}
            </div>
          </div>
        </th>
      </tr>
    );
  }

  return (
    <tr>
      <th
        scope="row"
        className={cn(
          CELL,
          "border-r border-border pl-4 pr-2 text-left text-xs font-normal text-muted-foreground",
        )}
      >
        {label}
      </th>
      <td className={cn(CELL, "pl-2 pr-4 text-left text-foreground")}>
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
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

/** Name plus description, used by Capabilities and Scheduled jobs. */
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
  // A row without detail must not reserve an empty second column, or it hangs a
  // strip of dead padding off the right edge of the surface.
  const hasDetail = detail !== null && detail !== undefined && detail !== "";
  return (
    <tr>
      <td
        className={cn(
          CELL,
          hasDetail ? "border-r border-border pl-4 pr-2" : "px-4",
        )}
        colSpan={hasDetail ? undefined : 2}
      >
        <span className="flex min-w-0 items-start gap-2">
          {/*
            `flex`, not a plain span: as a block it wrapped the inline-level
            glyph in a line box, which added four invisible pixels to every row
            in every one of these tables.
          */}
          <span className="mt-px flex shrink-0">{glyph}</span>
          <span
            className={cn(
              "min-w-0 break-words text-foreground",
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
            "pl-2 pr-4 text-xs leading-normal text-muted-foreground",
          )}
        >
          {detail}
        </td>
      ) : null}
    </tr>
  );
}

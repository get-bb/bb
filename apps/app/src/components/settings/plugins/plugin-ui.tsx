import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { usePreferredTheme } from "@/hooks/useTheme";
import type { PluginListItem } from "@/hooks/queries/plugin-settings-queries";

/**
 * Shared pieces of the Settings → Plugins surfaces. Tinted styles derive
 * from the theme anchors per the repo palette rules. These mix a *chromatic*
 * token (--success/--warning-text/--destructive-text) against the near-zero
 * chroma --canvas/--ink anchors, so they mix `in oklab`, not `in oklch`:
 * oklch would interpolate the hue from the anchor's 0° through to the token's
 * hue, dragging a low-percentage green mix through orange/pink. oklab
 * interpolates on the a/b axes, so the hue survives at every step. (The
 * general "opaque steps mix in oklch" rule is for neutral --ink/--canvas
 * derivations, where both poles are achromatic and there is no hue to lose.)
 */

/** Green "Update X.Y.Z" tint (sketch v2 `.pill.update`). */
export const UPDATE_TINT_STYLE = {
  background: "color-mix(in oklab, var(--success) 14%, var(--canvas))",
  borderColor: "color-mix(in oklab, var(--success) 35%, var(--canvas))",
  color: "color-mix(in oklab, var(--success) 80%, var(--ink))",
} as const;

/** Destructive "Needs attention" tint (sketch v2 `.pill.bad`). */
export const ATTENTION_TINT_STYLE = {
  background: "color-mix(in oklab, var(--destructive-text) 9%, var(--canvas))",
  borderColor:
    "color-mix(in oklab, var(--destructive-text) 28%, var(--canvas))",
  color: "var(--destructive-text)",
} as const;

/** Success verdict banner tint (sketch v2 `.banner`). */
export const SUCCESS_BANNER_STYLE = {
  background: "color-mix(in oklab, var(--success) 9%, var(--canvas))",
  borderColor: "color-mix(in oklab, var(--success) 35%, var(--canvas))",
} as const;

/** Warning note tint (sketch `.notebox.warn`, full-trust warning). */
export const WARNING_NOTE_STYLE = {
  background: "color-mix(in oklab, var(--warning-text) 6%, var(--canvas))",
  borderColor: "color-mix(in oklab, var(--warning-text) 35%, var(--canvas))",
} as const;

export const SUCCESS_TEXT_STYLE = {
  color: "color-mix(in oklab, var(--success) 80%, var(--ink))",
} as const;

/** Rich plugin identity for roomy settings rows and cards. */
export function PluginLogo({
  plugin,
  className,
}: {
  plugin: PluginListItem;
  className: string;
}) {
  const theme = usePreferredTheme();
  const logoUrl =
    theme === "dark" && plugin.logoDarkUrl !== null
      ? plugin.logoDarkUrl
      : plugin.logoUrl;
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  if (logoUrl === null || logoUrl === failedLogoUrl) {
    // No shipped image: use the manifest icon hint, falling back to the
    // generic plugin glyph (never a letter avatar).
    return (
      <PlaceholderBadge
        className={className}
        iconName={pluginIconName(plugin.icon)}
      />
    );
  }
  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      data-testid={`plugin-settings-logo-${plugin.id}`}
      className={cn("rounded-sm object-contain", className)}
      onError={() => setFailedLogoUrl(logoUrl)}
    />
  );
}

/**
 * Neutral avatar for entries without a shipped logo (installed rows, browse
 * cards and catalog status). Renders a bare generic glyph — a placeholder, not
 * the entry's initial and not a tile. The `className` sizes the footprint so
 * it aligns with sibling logo images.
 */
export function PlaceholderBadge({
  className,
  iconName = "Zap",
}: {
  className?: string;
  iconName?: IconName;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center text-muted-foreground",
        className,
      )}
    >
      <Icon name={iconName} className="size-5" />
    </span>
  );
}

export function formatAbsoluteDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
/** Key/value grid used in dialogs and the source-details disclosure. */
export function KeyValueGrid({
  entries,
}: {
  entries: { key: string; value: ReactNode; mono?: boolean }[];
}) {
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-xs">
      {entries.map((entry) => (
        <div key={entry.key} className="contents">
          <dt className="text-muted-foreground">{entry.key}</dt>
          <dd
            className={cn(
              "min-w-0 break-words text-foreground",
              entry.mono !== false && "font-mono",
            )}
          >
            {entry.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

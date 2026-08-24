import { z } from "zod";

/**
 * Declarative presentation for a timeline item, attached by the provider
 * bridge when it opens the item and persisted with the item's events.
 *
 * Presentation is how a client renders an item it has no special code for:
 * a generic `tool` item from a provider nobody wrote a renderer for, or an
 * extension kind whose plugin is uninstalled or upgraded. The persisted event
 * carries the snapshot, so an old row renders the same way forever, and
 * mobile renders the declarative base for every kind without plugin code.
 *
 * Core kinds always use core renderers; `presentation` customizes them
 * (label, icon, suppression) and never replaces them. Optional on every item
 * while rows persisted before bridges stamped it are upgraded at read time
 * (`legacy-thread-events.ts`); it becomes required together with the
 * `legacy-tool-item-backfill` migration (`LEGACY_TOOL_ITEM_BACKFILL_MIGRATION`)
 * that stamps those rows and retires that adapter.
 */
export const THREAD_EVENT_ITEM_PRESENTATION_DETAIL_MAX_LENGTH = 280;

export const threadEventItemPresentationLabelSchema = z.object({
  /** Present-tense row title while the item is in flight ("Reading file"). */
  pending: z.string().min(1),
  /** Past-tense row title once the item settled ("Read file"). */
  completed: z.string().min(1),
});
export type ThreadEventItemPresentationLabel = z.infer<
  typeof threadEventItemPresentationLabelSchema
>;

/**
 * The row's leading icon, by name. Two vocabularies share the one field:
 *
 * - a host glyph (`{ glyph: "FileText" }`), the same names the plugin
 *   branding and provider declaration icons use;
 * - a plugin-declared icon (`{ glyph: "echo-provider/receipt" }`), the
 *   namespaced form `"<pluginId>/<name>"` that names an entry of the
 *   plugin's manifest map `bb.branding.experimental_icons`
 *   (`NAMESPACED_GLYPH_PATTERN` in plugin-icon.ts). The server rejects at
 *   ingest a namespaced glyph that is not the emitting plugin's own declared
 *   icon; clients resolve the name against the plugin inventory they hold
 *   and draw the SVG tinted with `currentColor`.
 *
 * Both are names, never bytes or paths: the row persists the name and
 * follows the plugin's current map at render time. If the plugin is gone or
 * the name is unknown when the row renders, the icon is simply not found and
 * the per-kind fallback glyph draws instead — accepted, so a persisted row
 * never depends on a file that may have moved. The schema stays a plain
 * non-blank string on purpose: persisted rows must parse forever.
 */
export const threadEventItemPresentationIconSchema = z.object({
  glyph: z.string().min(1),
});
export type ThreadEventItemPresentationIcon = z.infer<
  typeof threadEventItemPresentationIconSchema
>;

export const threadEventItemPresentationTintSchema = z.object({
  light: z.string().min(1),
  dark: z.string().min(1),
});
export type ThreadEventItemPresentationTint = z.infer<
  typeof threadEventItemPresentationTintSchema
>;

// A conservative CSS <color> grammar: hex, the functional notations, and
// named colours. Anything else (a `url()`, a `var()`, an `expression()`)
// is plugin data a client must not inject into a style attribute.
const PRESENTATION_TINT_COLOR_PATTERN =
  /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([-+.%\w\s,/]*\)|[a-z]{3,20})$/iu;

/**
 * Whether one side of a tint is a plain CSS colour a client may paint with.
 * A predicate rather than a schema refinement on purpose: a tint that fails
 * the grammar still persists with its item and is simply ignored at render
 * time, so a bridge cannot lose a row over a colour value bb cannot paint.
 */
export function isPresentationTintColor(value: string): boolean {
  return PRESENTATION_TINT_COLOR_PATTERN.test(value.trim());
}

export const threadEventItemPresentationSchema = z.object({
  label: threadEventItemPresentationLabelSchema,
  icon: threadEventItemPresentationIconSchema,
  /** Row headline beside the label (a path, a query, a child thread title). */
  title: z.string().optional(),
  /**
   * Short Markdown summary shown in the row body. Length-capped here so a
   * bridge cannot turn the persisted row into a transcript.
   */
  detail: z
    .string()
    .max(THREAD_EVENT_ITEM_PRESENTATION_DETAIL_MAX_LENGTH)
    .optional(),
  /** Low-value rows (TodoWrite, ToolSearch) clients collapse by default. */
  suppress: z.boolean().optional(),
  /** Accent colour per theme; omitted rows use the neutral row tint. */
  tint: threadEventItemPresentationTintSchema.optional(),
});
export type ThreadEventItemPresentation = z.infer<
  typeof threadEventItemPresentationSchema
>;

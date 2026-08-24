import {
  isBackgroundAgentTaskType,
  isBackgroundCommandTaskType,
  isNamespacedGlyph,
} from "@bb/domain";
import type {
  TimelineActivityIntent,
  TimelineRowPresentation,
} from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import { primaryTimelineActivityIntent } from "./timeline-activity-intents.js";
import type { TimelineActivityIntentTitle } from "./timeline-row-title.js";
import type { TimelineViewWorkRow } from "./timeline-view.js";

/**
 * The glyph table for a work row's leading icon, shared by the web and
 * mobile renderers so the two cannot drift. This module carries no React:
 * each host narrows the bridge's glyph name against its own icon registry
 * and paints the result; everything else about which glyph a row gets is
 * decided here.
 */

/**
 * Glyph names the fallback table answers with. Every host icon registry
 * (`@bb/shared-ui/icon`, the mobile `icon-map`) carries each of them; a
 * host's typecheck proves it when it assigns the result to its `IconName`.
 */
export type TimelineWorkRowGlyph =
  | "CircleQuestion"
  | "EditFile"
  | "File"
  | "FileText"
  | "Folder"
  | "Globe"
  | "ListTodo"
  | "Lock"
  | "Puzzle"
  | "Search"
  | "Terminal"
  | "UserRoundPlus"
  | "Zap";

const SKILL_FILE_NAME = "SKILL.md";

function isSkillReadIntent(intent: TimelineActivityIntent): boolean {
  if (intent.type !== "read") {
    return false;
  }
  const target = (intent.path ?? intent.name).replaceAll("\\", "/");
  return target.split("/").pop() === SKILL_FILE_NAME;
}

/**
 * Per-intent glyph for an exploration row, shared by the bundled compact
 * intent listing and the unbundled standalone row so the icon for a given
 * intent kind (search / read / list_files) is identical in both surfaces.
 */
function explorationIntentGlyph(
  intentType: "read" | "list_files" | "search",
): TimelineWorkRowGlyph {
  switch (intentType) {
    case "search":
      return "Search";
    case "read":
      return "FileText";
    case "list_files":
      return "Folder";
    default:
      return assertNever(intentType);
  }
}

/** Leading glyph of one compact activity-intent line inside a summary. */
export function activityIntentTitleGlyph(
  entry: TimelineActivityIntentTitle,
): TimelineWorkRowGlyph {
  if (isSkillReadIntent(entry.intent)) {
    return "Zap";
  }
  return explorationIntentGlyph(entry.intentType);
}

/**
 * The bridge's persisted presentation for a work row (grammar v3), or
 * undefined for the rows bb authors itself (approvals, questions) and for
 * rows persisted before presentation existed. The declarative base every
 * client renders from.
 */
export function workRowPresentation(
  row: TimelineViewWorkRow,
): TimelineRowPresentation | undefined {
  if (row.workKind === "approval" || row.workKind === "question") {
    return undefined;
  }
  return row.presentation;
}

/**
 * The per-kind glyph a row falls back to without a usable bridge glyph. A
 * command or exploration row carrying a single exploration intent renders as
 * a flat, non-expandable row, so the per-intent search/read/folder glyph
 * comes from here too (not only from the bundled compact-intent path);
 * otherwise it would fall through to the generic Terminal icon.
 */
function fallbackGlyphForWorkRow(
  row: TimelineViewWorkRow,
): TimelineWorkRowGlyph {
  if (
    row.workKind === "command" ||
    row.workKind === "file-read" ||
    row.workKind === "search"
  ) {
    const intent = primaryTimelineActivityIntent(row);
    if (intent !== null && intent.type !== "unknown") {
      return explorationIntentGlyph(intent.type);
    }
  }
  switch (row.workKind) {
    case "file-change":
      return "EditFile";
    case "command":
    case "tool":
      return "Terminal";
    case "file-read":
      return "FileText";
    case "search":
      return "Search";
    case "plan-steps":
      return "ListTodo";
    case "extension":
      return "Puzzle";
    case "web-search":
      return "Search";
    case "web-fetch":
      return "Globe";
    case "image-view":
      return "File";
    case "delegation":
      return "UserRoundPlus";
    case "workflow":
      // Background tasks reuse the workflow row shape but read by task type.
      if (isBackgroundCommandTaskType(row.taskType)) {
        return "Terminal";
      }
      if (isBackgroundAgentTaskType(row.taskType)) {
        return "UserRoundPlus";
      }
      return "ListTodo";
    case "approval":
      return "Lock";
    case "question":
      return "CircleQuestion";
    default:
      return assertNever(row);
  }
}

/**
 * A leading glyph for every work row, keyed so edits, explores and commands
 * read apart at a glance. A SKILL.md read keeps its Zap over anything the
 * bridge named. Otherwise the bridge's glyph (grammar v3 presentation) is
 * the row's icon whenever the host's registry knows it (`isHostGlyph`); the
 * per-kind table is the fallback for rows persisted before presentation
 * existed and for glyph names the host cannot draw.
 */
export function workRowGlyph<HostGlyph extends string>(
  row: TimelineViewWorkRow,
  isHostGlyph: (glyph: string) => glyph is HostGlyph,
): HostGlyph | TimelineWorkRowGlyph {
  if (isSkillReadCommandRow(row)) {
    return "Zap";
  }
  const presented = workRowPresentation(row)?.icon.glyph;
  if (presented !== undefined && isHostGlyph(presented)) {
    return presented;
  }
  return fallbackGlyphForWorkRow(row);
}

/**
 * The plugin-declared icon a row names, as the namespaced glyph
 * `"<pluginId>/<name>"` (`bb.branding.experimental_icons`), or undefined when
 * the row names a host glyph, nothing, or is a SKILL.md read (whose Zap wins
 * over anything the bridge named, exactly as in {@link workRowGlyph}). A
 * host resolves the glyph against the plugin inventory it holds and draws
 * the SVG when the plugin still declares it; otherwise it draws
 * {@link workRowGlyph}'s answer, which for a namespaced glyph is the per-kind
 * fallback. Resolution stays in the host because only the host knows which
 * plugins are installed.
 */
export function workRowPluginGlyph(
  row: TimelineViewWorkRow,
): string | undefined {
  if (isSkillReadCommandRow(row)) {
    return undefined;
  }
  const presented = workRowPresentation(row)?.icon.glyph;
  return presented !== undefined && isNamespacedGlyph(presented)
    ? presented
    : undefined;
}

function isSkillReadCommandRow(row: TimelineViewWorkRow): boolean {
  return (
    row.workKind === "command" && row.activityIntents.some(isSkillReadIntent)
  );
}

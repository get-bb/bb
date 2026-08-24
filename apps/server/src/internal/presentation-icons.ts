/**
 * Ingest validation for namespaced presentation glyphs.
 *
 * A row's `presentation.icon.glyph` is either a host glyph (`"FileText"`) or
 * a plugin-declared icon by its namespaced glyph (`"<pluginId>/<name>"`,
 * `bb.branding.experimental_icons`). Clients resolve the latter against the
 * plugin inventory they hold, so a glyph that names another plugin, or a
 * name the emitting plugin never declared, would persist a row whose icon
 * can never be found. It is refused here, before the event is persisted,
 * with the same visible fate as an extension payload that fails its schema:
 * the event is replaced by a `provider/unhandled` carrying the item's
 * identity, the glyph and the reason, and the batch keeps its shape.
 *
 * Which plugin "emitted" the row decides what the glyph is checked against.
 * A row the provider bridge authored is checked against the thread's
 * provider plugin. A `server: "bb"` tool row is a call to a tool some plugin
 * registered through `bb.agents.registerTool`: the server resolved its
 * presentation from that plugin's declaration (the glyph was checked against
 * the plugin's manifest at registration) and handed it to the bridge, which
 * stamps it on the row — so that glyph is checked against the tool's own
 * plugin, which is normally not the thread's provider plugin.
 *
 * Unnamespaced glyphs are untouched: whether a host can draw `"Zap"` is the
 * client's call, and the per-kind fallback covers a name it cannot.
 */
import { getThread } from "@bb/db";
import type { ThreadEvent, ThreadEventWithItem } from "@bb/domain";
import { isThreadEventWithItem, parseNamespacedGlyph } from "@bb/domain";
import type { HostDaemonEventEnvelope } from "@bb/host-daemon-contract";
import { findPluginAgentTool } from "../services/plugins/plugin-agent-contributions.js";
import { undeclaredIconProblem } from "@get-bb/plugin-sdk/internal/host-policy";
import type { AppDeps } from "../types.js";

export type PresentationIconValidationDeps = Pick<
  AppDeps,
  "db" | "logger" | "providerRegistry"
>;

/**
 * The `server` a bridge stamps on a call to a bb-injected tool (the
 * provider-bridge protocol's `item.open` for a bb tool; the ACP and echo
 * bridges both write it).
 */
const BB_TOOL_SERVER = "bb";

/**
 * An item event carrying a namespaced glyph. Every event that carries a
 * full item is a site — the turn-scoped open/close pair and the
 * thread-scoped delegation/background-task snapshots alike — because the
 * assembler stamps the close's presentation on the thread-scoped terminal
 * snapshot, which is the only place a background delegation's or task's
 * final glyph ever appears.
 */
interface PresentationIconSite {
  glyph: string;
  /** The plugin the glyph names (`"<pluginId>/<name>"`). */
  glyphPluginId: string;
  event: ThreadEventWithItem;
}

function presentationIconSiteOf(
  event: ThreadEvent,
): PresentationIconSite | null {
  if (!isThreadEventWithItem(event)) {
    return null;
  }
  // Not every item kind carries a presentation (bb-authored approvals and
  // questions never do), so narrow on the field rather than the kind.
  const glyph =
    "presentation" in event.item
      ? event.item.presentation?.icon.glyph
      : undefined;
  const parsed = glyph === undefined ? null : parseNamespacedGlyph(glyph);
  if (glyph === undefined || parsed === null) {
    return null;
  }
  return { glyph, glyphPluginId: parsed.pluginId, event };
}

/**
 * Whether the site is a `server: "bb"` tool row whose glyph is exactly the
 * declared presentation icon of the tool, as registered right now by the
 * plugin the glyph names. The name was verified against that plugin's
 * manifest at `registerTool`, so nothing else needs checking here. A tool
 * that is no longer registered, is registered by a different plugin than the
 * glyph names, or declares a different icon falls through to the provider
 * rule.
 */
function isRegisteredBbToolIcon(site: PresentationIconSite): boolean {
  const { item } = site.event;
  if (item.type !== "toolCall" || item.server !== BB_TOOL_SERVER) {
    return false;
  }
  const tool = findPluginAgentTool(item.tool);
  return (
    tool !== undefined &&
    tool.pluginId === site.glyphPluginId &&
    tool.record.presentation?.icon?.glyph === site.glyph
  );
}

/**
 * The reason a namespaced glyph on this thread's row is refused, or null.
 * `providerId` is the thread's provider (null for an unknown thread); its
 * live registration names the plugin that emitted the row and the icons
 * that plugin declares.
 */
function presentationIconProblem(
  deps: PresentationIconValidationDeps,
  site: PresentationIconSite,
  providerId: string | null,
): string | null {
  if (isRegisteredBbToolIcon(site)) {
    return null;
  }
  const registration =
    providerId === null ? null : deps.providerRegistry.get(providerId);
  if (registration === null) {
    return `presentation.icon "${site.glyph}" names a plugin icon, but the thread's provider has no live registration to check it against`;
  }
  const problem = undeclaredIconProblem(
    registration.pluginId,
    registration.iconNames,
    site.glyph,
  );
  return problem === null ? null : `presentation.icon ${problem}`;
}

/**
 * The rejected event's visible replacement: the thread's provider id is what
 * `provider/unhandled` is counted under; the item's identity, the glyph and
 * the reason ride the raw event so the row is diagnosable; scope and parent
 * are kept so it sits where the original would have.
 */
function toUnhandledEvent(
  site: PresentationIconSite,
  providerId: string | null,
  reason: string,
): ThreadEvent {
  const { event } = site;
  return {
    type: "provider/unhandled",
    threadId: event.threadId,
    providerThreadId: event.providerThreadId,
    providerId: providerId ?? "unknown",
    rawType: `presentation/icon:${event.item.type}`,
    rawEvent: {
      jsonrpc: "2.0",
      method: event.type,
      params: {
        itemId: event.item.id,
        itemType: event.item.type,
        glyph: site.glyph,
        reason,
      },
    },
    scope: event.scope,
    ...(event.item.parentToolCallId === undefined
      ? {}
      : { parentToolCallId: event.item.parentToolCallId }),
  };
}

/**
 * Validate every namespaced presentation glyph in a batch. Returns envelopes
 * in the same order and count; a rejected event is replaced by its
 * `provider/unhandled`.
 */
export function validatePresentationIcons(
  deps: PresentationIconValidationDeps,
  envelopes: readonly HostDaemonEventEnvelope[],
): HostDaemonEventEnvelope[] {
  return envelopes.map((envelope) => {
    const site = presentationIconSiteOf(envelope.event);
    if (site === null) {
      return envelope;
    }
    // One thread lookup per site: the provider id decides which registration
    // the glyph is checked against and what a replacement is counted under.
    const providerId =
      getThread(deps.db, site.event.threadId)?.providerId ?? null;
    const reason = presentationIconProblem(deps, site, providerId);
    if (reason === null) {
      return envelope;
    }
    deps.logger.warn(
      {
        threadId: envelope.threadId,
        eventType: envelope.event.type,
        itemType: site.event.item.type,
        glyph: site.glyph,
        reason,
      },
      "Rejected provider presentation icon at ingest",
    );
    return { ...envelope, event: toUnhandledEvent(site, providerId, reason) };
  });
}

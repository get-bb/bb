/**
 * Renderer registration. Importing this module registers every timeline row
 * renderer with the registry in `../renderers.ts`; `TimelineList` imports it
 * for its side effects (as does the dev work-rows showcase). Each renderer
 * module registers its own kinds at import time; add a new module by
 * importing it here.
 *
 * Rows render under `TimelineRowHostProvider` (../host), which supplies the
 * per-thread services they reach through context (server URL, lightbox,
 * message actions, sender metadata, navigation).
 */
import { hasTimelineRowRenderer } from "../renderers";
import { TIMELINE_ROW_KINDS } from "../rows";
import "./conversation";
import "./work";
import "./system";
import "./turn";
import "./summaries";

if (__DEV__) {
  const missing = TIMELINE_ROW_KINDS.filter(
    (kind) => !hasTimelineRowRenderer(kind),
  );
  if (missing.length > 0) {
    console.warn(
      `Timeline row kinds without a renderer (falling back to the raw row): ${missing.join(", ")}`,
    );
  }
}

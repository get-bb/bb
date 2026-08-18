import type { ReactElement } from "react";
import type { IconName } from "@bb/shared-ui/icon";

/**
 * One "here is what you could build" example in a showcase hero.
 *
 * Both the Plugins and Skills browse surfaces answer the same two questions for
 * a newcomer — what can this thing do, and what would mine be — so they share
 * this shape and the engine that renders it. Everything surface-specific (the
 * nouns, the scenes, the prompt prefix) is supplied as content, not forked.
 */
export interface ShowcaseArchetype {
  id: string;
  /** Completes the headline lead, e.g. "Turn bb into …" / "Teach bb to …". */
  noun: string;
  /** Chip, tab, and mini-window title. */
  title: string;
  /** One-line "what you can build" hook, shown on the cards. */
  hook: string;
  /** The real capability behind the example, so the pitch stays checkable. */
  capability: string;
  icon: IconName;
  /**
   * The chromatic theme token this archetype tints with. Always a token, never
   * a literal, so a custom palette retints the whole hero.
   */
  accentToken: string;
  /** Completes the surface's prompt prefix; seeds the composer. */
  brief: string;
}

/** A mini-window interior. Scenes are components, never image assets. */
export type ShowcaseScene = (props: { accentToken: string }) => ReactElement;

/** Scene renderers keyed by archetype id. */
export type ShowcaseScenes = Record<string, ShowcaseScene>;

/** Stable, readable ids derived from the title. */
export function showcaseArchetypeId(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** The full composer prompt for an archetype on a given surface. */
export function showcaseArchetypePrompt(
  promptPrefix: string,
  archetype: ShowcaseArchetype,
): string {
  return `${promptPrefix}${archetype.brief}.`;
}

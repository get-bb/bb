// The routing decision itself: what to ask the model, and what to do with
// the answer. Both halves are pure so they can be tested without a server,
// a catalog probe or an inference call — server.ts is wiring.

import type { JsonValue } from "@get-bb/plugin-sdk";
import {
  describeCatalog,
  formatModelSlot,
  lookupModel,
  nearestSupportedReasoningLevel,
  REASONING_LADDER,
  type ModelCatalog,
  type ReasoningLevel,
} from "./catalog.js";

/**
 * How much of the submitted prompt the routing question carries.
 *
 * Routing is a decision about a prompt's *kind*, not its content: "is this a
 * quick question or a refactor" is legible in the opening paragraphs, and the
 * tail of a 40KB paste adds latency and cost to a call that sits in front of
 * every send. The head is kept rather than a summary because the head is what
 * a human skims to make the same judgement.
 */
export const MAX_ROUTED_TEXT_CHARS = 2_000;

const TRUNCATION_MARKER = "\n[… prompt truncated for routing …]";

/**
 * The JSON Schema the routed answer must satisfy.
 *
 * `reasoningLevel` is deliberately optional: "leave bb's answer alone" is a
 * real routing outcome, and a required field would make the model invent an
 * effort level for a prompt whose effort it has no opinion about. `providerId`
 * and `model` are required together because a model name without its provider
 * cannot be looked up — model ids are not unique across providers.
 */
export const ROUTING_OUTPUT_SCHEMA: Record<string, JsonValue> = {
  type: "object",
  properties: {
    providerId: {
      type: "string",
      description: "The providerId of the chosen row, copied exactly.",
    },
    model: {
      type: "string",
      description: "The model of the chosen row, copied exactly.",
    },
    reasoningLevel: {
      type: "string",
      enum: [...REASONING_LADDER],
      description:
        "How much reasoning effort to spend, from the levels the chosen model lists. Omit to leave bb's own choice alone.",
    },
  },
  required: ["providerId", "model"],
  additionalProperties: false,
};

export function truncateRoutedText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_ROUTED_TEXT_CHARS) return trimmed;
  return trimmed.slice(0, MAX_ROUTED_TEXT_CHARS) + TRUNCATION_MARKER;
}

export interface BuildRoutingPromptArgs {
  /** The user's rules, verbatim. */
  routingPrompt: string;
  /** The prompt being dispatched. */
  text: string;
  catalog: ModelCatalog;
  /** Non-null once the thread's provider is fixed; see `describeCatalog`. */
  lockedProviderId: string | null;
}

/**
 * Assemble the routing question, or null when there is nothing to ask about.
 *
 * Null rather than an empty prompt for the two cases that are not failures:
 * a catalog with no eligible row (nothing to choose between), and an empty
 * request (nothing to classify). Both mean "proceed on bb's own answer", and
 * spending an inference call to be told so would be waste.
 *
 * The user's rules go last. Everything before them is bb's framing, and a
 * routing prompt that says "always use the cheapest model" should be the last
 * word the model reads, not something buried above a catalog listing.
 */
export function buildRoutingPrompt(args: BuildRoutingPromptArgs): string | null {
  const options = describeCatalog(args.catalog, args.lockedProviderId);
  if (options === "") return null;
  const text = truncateRoutedText(args.text);
  if (text === "") return null;

  const scope =
    args.lockedProviderId === null
      ? "Choose one row from the list."
      : `This thread already runs on provider "${args.lockedProviderId}" and cannot change provider, so choose one of its rows.`;

  return [
    "You are choosing which model should handle one request in a coding assistant.",
    "",
    "Available rows:",
    options,
    "",
    scope,
    'Answer with the "providerId" and "model" copied exactly from the row you chose.',
    'Optionally add "reasoningLevel", but only one of the levels that row lists.',
    "",
    "The request:",
    "<request>",
    text,
    "</request>",
    "",
    "The user's routing rules, which decide the answer:",
    "<rules>",
    args.routingPrompt,
    "</rules>",
  ].join("\n");
}

/**
 * What the gate does with an answer.
 *
 * `unroutable` is not an error: every one of its causes (a hallucinated model,
 * a provider the thread cannot switch to, a level nobody offers) means bb's
 * own resolved execution is still correct, and Auto's documented fallback is
 * exactly that. The reason travels so the debug log can say which it was.
 */
export type RouteOutcome =
  | {
      kind: "route";
      providerId: string;
      model: string;
      /** Null when the answer named no level, or none could be honoured. */
      reasoningLevel: ReasoningLevel | null;
    }
  | { kind: "unroutable"; reason: string };

function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return (
    typeof value === "string" &&
    (REASONING_LADDER as readonly string[]).includes(value)
  );
}

export interface ReadRouteChoiceArgs {
  /** The completion's answer. Schema-validated by bb, catalog-checked here. */
  value: Record<string, JsonValue>;
  catalog: ModelCatalog;
  lockedProviderId: string | null;
}

/**
 * Turn an answer into an amendment, or explain why it cannot be one.
 *
 * bb has already checked the answer against `ROUTING_OUTPUT_SCHEMA`, so the
 * shape is sound; what it cannot check is that the named row exists, that the
 * provider is one this dispatch may still choose, and that the level is one
 * the chosen model advertises. All three are checked here because an
 * amendment core cannot honour does not degrade — it fails the dispatch with
 * this plugin named.
 */
export function readRouteChoice(args: ReadRouteChoiceArgs): RouteOutcome {
  const { providerId, model, reasoningLevel } = args.value;
  if (typeof providerId !== "string" || typeof model !== "string") {
    return { kind: "unroutable", reason: "the answer named no provider/model" };
  }
  const slot = { providerId, model };
  if (args.lockedProviderId !== null && providerId !== args.lockedProviderId) {
    return {
      kind: "unroutable",
      reason: `chose provider "${providerId}", but this thread is fixed on "${args.lockedProviderId}"`,
    };
  }
  const entry = lookupModel(args.catalog, slot);
  if (entry === null) {
    return {
      kind: "unroutable",
      reason: `chose "${formatModelSlot(slot)}", which no available provider offers`,
    };
  }
  if (reasoningLevel === undefined) {
    return { kind: "route", providerId, model, reasoningLevel: null };
  }
  if (!isReasoningLevel(reasoningLevel)) {
    return {
      kind: "unroutable",
      reason: `chose reasoning level ${JSON.stringify(reasoningLevel)}, which is not a level bb has`,
    };
  }
  return {
    kind: "route",
    providerId,
    model,
    reasoningLevel: nearestSupportedReasoningLevel(
      entry.supportedReasoningLevels,
      reasoningLevel,
    ),
  };
}

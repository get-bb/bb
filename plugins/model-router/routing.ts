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
 * How the answer is asked for and read back.
 *
 * The routing agent is a real thread, not a tool-call: nothing constrains its
 * output to a schema, so the shape is requested in prose and enforced here.
 * `reasoningLevel` stays optional for the same reason it always was — "leave
 * bb's answer alone" is a real routing outcome, and a required field would
 * make the model invent an effort level for a prompt whose effort it has no
 * opinion about. `providerId` and `model` are required together because a
 * model name without its provider cannot be looked up: model ids are not
 * unique across providers.
 */
const ANSWER_INSTRUCTIONS = [
  "Answer with ONE fenced JSON object and nothing else after it:",
  "",
  "```json",
  '{ "providerId": "…", "model": "…", "reasoningLevel": "…" }',
  "```",
  "",
  '"providerId" and "model" are required and must be copied EXACTLY from the',
  'row you chose. "reasoningLevel" is optional — include it only to ask for a',
  `specific effort, and only one of ${REASONING_LADDER.join(", ")} that the`,
  "chosen row lists. Omit it to leave the default effort alone.",
].join("\n");

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
    "This is a routing decision only: do not answer the request, do not read or",
    "edit any files, and do not use tools. Reply with the chosen row.",
    "",
    "Available rows:",
    options,
    "",
    scope,
    "",
    ANSWER_INSTRUCTIONS,
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

/** A fenced block's body, in the order they appear. */
function fencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /```[^\n]*\n([\s\S]*?)```/g;
  let match = pattern.exec(text);
  while (match !== null) {
    if (match[1] !== undefined) blocks.push(match[1]);
    match = pattern.exec(text);
  }
  return blocks;
}

function parseJsonObject(text: string): Record<string, JsonValue> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, JsonValue>;
}

/**
 * Pull the routing answer out of an agent's final message.
 *
 * Tolerant on purpose, because the answer is prose from a real thread rather
 * than a validated tool call: a model that explains itself first, forgets the
 * `json` info string, or wraps the object in a sentence is still answering.
 * The three shapes accepted are a fenced block, a bare object anywhere in the
 * text, and the whole message being the object.
 *
 * The LAST candidate wins throughout. A model that restates its answer means
 * the restatement, and a model that shows its working ("not `codex/gpt-5`,
 * because…") would otherwise be read as choosing the row it rejected.
 *
 * Null means "no object in there", which is a routing failure like any other
 * and proceeds on bb's defaults.
 */
export function readFencedJsonObject(
  output: string | null,
): Record<string, JsonValue> | null {
  if (output === null) return null;
  const blocks = fencedBlocks(output);
  for (const block of [...blocks].reverse()) {
    const parsed = parseJsonObject(block.trim());
    if (parsed !== null) return parsed;
  }
  const whole = parseJsonObject(output.trim());
  if (whole !== null) return whole;
  // Balanced-brace scan from each `{`, last first: `JSON.parse` on the widest
  // span would fail on any prose around it, and a `}` inside a string value
  // makes a naive last-`}` slice wrong.
  const starts: number[] = [];
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] === "{") starts.push(index);
  }
  for (const start of starts.reverse()) {
    const end = matchingBraceEnd(output, start);
    if (end === null) continue;
    const parsed = parseJsonObject(output.slice(start, end + 1));
    if (parsed !== null) return parsed;
  }
  return null;
}

/** Index of the `}` closing the `{` at `start`, string-aware; null if unclosed. */
function matchingBraceEnd(text: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
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
  /** The object parsed out of the routing agent's answer. */
  value: Record<string, JsonValue>;
  catalog: ModelCatalog;
  lockedProviderId: string | null;
}

/**
 * Turn an answer into an amendment, or explain why it cannot be one.
 *
 * Nothing upstream has checked this object: it was parsed out of an agent's
 * prose, so every field is a claim. Four things are checked here — that the
 * pair is even a pair of strings, that the named row exists, that the provider
 * is one this dispatch may still choose, and that the level is one the chosen
 * model advertises — because an amendment core cannot honour does not degrade.
 * It is refused, and a refused amendment is a routing decision thrown away.
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

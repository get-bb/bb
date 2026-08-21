import { providerForkSchema } from "@bb/domain";
import { z } from "zod";
import { PROVIDER_BRIDGE_PROTOCOL_VERSION } from "./version.js";

/**
 * The inclusive `[min, max]` range of `thread/delta` grammar versions a bridge
 * speaks. Distinct from the JSON-RPC `protocolVersion`: the envelope can stay
 * put while the delta vocabulary grows, and a bridge that speaks both v2 and
 * v3 says so here instead of forcing a daemon bump.
 */
export const bridgeGrammarVersionsSchema = z
  .tuple([z.number().int().positive(), z.number().int().positive()])
  .refine(([min, max]) => min <= max, {
    message: "grammarVersions must be an ascending [min, max] range",
  });
export type BridgeGrammarVersions = z.infer<typeof bridgeGrammarVersionsSchema>;

/**
 * Two-way grammar negotiation. The runtime states the range its assembler
 * speaks in the `initialize` params; the bridge states its own range in the
 * `initialize` result; both sides may use any version in the intersection,
 * and the highest common version is the one a bridge should emit. Disjoint
 * ranges fail the handshake the way a wrong `protocolVersion` does — a bridge
 * that can only emit a grammar the runtime cannot assemble must not start.
 *
 * A side that says nothing is read as `[protocolVersion, protocolVersion]`,
 * so an older runtime that predates the field keeps a newer bridge on the
 * version it negotiated, and an older bridge keeps emitting what it always
 * did.
 */
export function negotiateGrammarVersion(
  runtime: BridgeGrammarVersions,
  bridge: BridgeGrammarVersions,
): number | null {
  const min = Math.max(runtime[0], bridge[0]);
  const max = Math.min(runtime[1], bridge[1]);
  return min <= max ? max : null;
}

/**
 * How the bridge delivers `turn/steer` while a turn is live. `inject` feeds
 * the steer text into the running model loop (claude, codex); `queue` holds
 * it for the next prompt boundary (ACP v1 cancels the live prompt and
 * re-prompts with the queued text). The runtime sends `turn/steer` either
 * way; the mode is what the composer tells the user and what WS4's recovery
 * logic keys `staleTurn` on.
 */
export const bridgeSteerModeSchema = z.enum(["inject", "queue"]);
export type BridgeSteerMode = z.infer<typeof bridgeSteerModeSchema>;

/**
 * Session-behavior facts the bridge reports at `initialize`. These are
 * deliberately NOT provider declarations: the code that implements a feature
 * is the code that reports it, so a handshake fact cannot drift from behavior
 * the way a declared boolean can.
 *
 * Every field defaults on parse so an older bridge that omits a capability is
 * read as not having it — absence is a definite "no", never an error, and the
 * parsed object always carries explicit values internally.
 *
 * The schema is loose: unknown capability fields from a newer bridge pass
 * through untouched so a newer plugin works against an older runtime.
 */
export const bridgeCapabilitiesSchema = z
  .object({
    /**
     * A released session can be re-attached later from its persisted
     * providerThreadId. The per-session `sessionRestorable` flag on
     * thread-identity results refines this (an agent update can drop restore
     * support mid-flight); this handshake value is the default for sessions
     * that do not say.
     */
    sessionRestore: z.boolean().default(false),
    /**
     * The bridge mirrors bb archive state into the provider's own session
     * list. When false the runtime never sends thread/archive or
     * thread/unarchive.
     */
    threadArchive: z.boolean().default(false),
    /**
     * The bridge pushes bb thread titles to the provider. When false the
     * runtime never sends thread/name/set.
     */
    threadRename: z.boolean().default(false),
    /** The bridge supports thread/goal/clear. */
    threadGoalClear: z.boolean().default(false),
    /**
     * Session cloning support ({@link providerForkSchema} — the same
     * vocabulary the provider declaration uses). The declaration is a ceiling
     * for UI affordances; this is the operative truth, and it may only narrow
     * the declaration, never widen it.
     */
    fork: providerForkSchema.default("none"),
    /**
     * Where the thread's approval policy is enforced. "runtime" bridges
     * forward every approval request and the runtime applies the thread
     * policy (including auto-deny). "provider" bridges enforce policy before
     * forwarding, so every forwarded request is already known to need user
     * input and the runtime must not reclassify it against mutable thread
     * settings.
     */
    approvalEnforcedBy: z.enum(["runtime", "provider"]).default("runtime"),
    /**
     * The `thread/delta` grammar range this bridge speaks. A bridge that says
     * nothing speaks exactly the protocol version it negotiated — today's
     * bridges all emit v2 — so the default is `[2, 2]`, never a wider range
     * it never claimed. A v3-capable bridge reports `[2, 3]` (or `[3, 3]`
     * once the v2 paths are deleted) and emits the highest version inside
     * the intersection with the runtime's `initialize` params range
     * ({@link negotiateGrammarVersion}); the runtime rejects a disjoint
     * range at startup.
     */
    grammarVersions: bridgeGrammarVersionsSchema.default([
      PROVIDER_BRIDGE_PROTOCOL_VERSION,
      PROVIDER_BRIDGE_PROTOCOL_VERSION,
    ]),
    /**
     * Mid-turn steer delivery ({@link bridgeSteerModeSchema}). Defaults to
     * `queue`, the conservative reading: absence is the definite "no" the
     * rest of this handshake uses, and `inject` is the stronger promise (the
     * steer reaches the model before the turn ends) a bridge must make
     * explicitly. Nothing in the runtime branches on it yet, so the default
     * changes no behavior today; claude and codex declare `inject` before WS4
     * reads it.
     */
    steerMode: bridgeSteerModeSchema.default("queue"),
  })
  .passthrough();

export type BridgeCapabilities = z.infer<typeof bridgeCapabilitiesSchema>;

/** Runtime → bridge `initialize` params. */
export const initializeParamsSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    client: z.object({ name: z.string().min(1), version: z.string().min(1) }),
    /**
     * The `thread/delta` grammar range the runtime's assembler accepts (see
     * {@link negotiateGrammarVersion}). A runtime that predates the field
     * reads as speaking exactly its protocol version.
     */
    grammarVersions: bridgeGrammarVersionsSchema.default([
      PROVIDER_BRIDGE_PROTOCOL_VERSION,
      PROVIDER_BRIDGE_PROTOCOL_VERSION,
    ]),
  })
  .passthrough();

/** Bridge → runtime `initialize` result. */
export const initializeResultSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    // An absent capabilities block reads as "no capabilities" via the inner
    // per-field defaults, so older bridges parse to explicit values.
    capabilities: z.preprocess(
      (value) => value ?? {},
      bridgeCapabilitiesSchema,
    ),
  })
  .passthrough();

export type InitializeResult = z.infer<typeof initializeResultSchema>;

import { z } from "zod";

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
    archiveSync: z.boolean().default(false),
    /**
     * The bridge pushes bb thread titles to the provider. When false the
     * runtime never sends thread/name/set.
     */
    nameSync: z.boolean().default(false),
    /** The bridge supports thread/goal/clear. */
    goalState: z.boolean().default(false),
    /** The bridge supports explicit context compaction via thread/compact. */
    manualCompaction: z.boolean().default(false),
    /**
     * Session cloning support. "tip" clones only the current end of a session
     * (ACP session/fork); "checkpoint" can recreate a session at an earlier
     * point (required for edit-past-message rewind). The provider declaration
     * advertises fork coarsely for UI affordances; this is the operative
     * truth, and it may only narrow the declaration, never widen it.
     */
    fork: z.enum(["none", "tip", "checkpoint"]).default("none"),
    /**
     * Where the thread's approval policy is enforced. "runtime" bridges
     * forward every approval request and the runtime applies the thread
     * policy (including auto-deny). "provider" bridges enforce policy before
     * forwarding, so every forwarded request is already known to need user
     * input and the runtime must not reclassify it against mutable thread
     * settings.
     */
    approvalRequestPolicy: z.enum(["runtime", "provider"]).default("runtime"),
  })
  .passthrough();

export type BridgeCapabilities = z.infer<typeof bridgeCapabilitiesSchema>;

/** Runtime → bridge `initialize` params. */
export const initializeParamsSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    client: z.object({ name: z.string().min(1), version: z.string().min(1) }),
  })
  .passthrough();

export type InitializeParams = z.infer<typeof initializeParamsSchema>;

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

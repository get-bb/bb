import { providerRecoveryKindSchema } from "@bb/domain";
import { z } from "zod";

/**
 * JSON-RPC error codes on the bridge wire.
 *
 * The hygiene rules these back (from #853): an undecodable request is
 * answered with `INVALID_PARAMS` carrying the validation issues — never
 * silently dropped; an unrecognized method is answered with
 * `METHOD_NOT_FOUND`; request vs response is discriminated on the presence of
 * `method`, never on result-shape guessing.
 */
export const BRIDGE_JSON_RPC_ERRORS = {
  /** Standard JSON-RPC: params failed schema validation. */
  INVALID_PARAMS: -32602,
  /** Standard JSON-RPC: method not implemented by this bridge. */
  METHOD_NOT_FOUND: -32601,
  /** Generic bridge failure. */
  BRIDGE_ERROR: -32000,
  /** A turn/steer arrived but the session has no active turn. */
  NO_ACTIVE_TURN: -32001,
  /** thread/resume for a session the provider can no longer restore. */
  SESSION_NOT_RESTORABLE: -32002,
  /** thread/fork with a checkpoint on a bridge that only forks at the tip. */
  FORK_CHECKPOINT_UNSUPPORTED: -32003,
} as const;

/**
 * A typed recovery hint: what went wrong in the provider's own terms and
 * whether the runtime may retry after acting on it. One payload, two
 * carriers: a rejected request carries it as `error.data.recovery` (the
 * JSON-RPC id is the correlation); a condition with no request to ride on
 * (a terminal 401 mid-turn) rides the `provider/recovery` notification.
 * Never both for one event. The runtime keys on `kind` and matches no text.
 */
export const providerRecoveryHintSchema = z.object({
  kind: providerRecoveryKindSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type ProviderRecoveryHint = z.infer<typeof providerRecoveryHintSchema>;

/**
 * Optional `error.data` on any bridge → runtime JSON-RPC error response.
 * Additive: a response without `data` is a plain failure.
 */
export const bridgeErrorDataSchema = z
  .object({ recovery: providerRecoveryHintSchema.optional() })
  .passthrough();
export type BridgeErrorData = z.infer<typeof bridgeErrorDataSchema>;

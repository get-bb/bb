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

export type BridgeJsonRpcErrorCode =
  (typeof BRIDGE_JSON_RPC_ERRORS)[keyof typeof BRIDGE_JSON_RPC_ERRORS];

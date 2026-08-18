/**
 * Structural contracts shared by the runtime's generic adapter and the bridge
 * implementations that translate a provider's native protocol.
 *
 * These are the shapes a bridge produces or consumes while it maps its
 * provider onto the canonical protocol. They live in the kit (rather than in
 * `@bb/agent-runtime`) so a bridge shipped from a plugin never depends on the
 * runtime package.
 */
import type {
  PendingInteractionPayload,
  PendingInteractionResolution,
} from "@bb/domain";

export interface ProviderRequestCommandPlan {
  kind: "request";
  method: string;
  params?: object;
}

export interface ProviderNoopCommandPlan {
  kind: "noop";
  method?: never;
  params?: never;
  reason: string;
}

export type ProviderCommandPlan =
  | ProviderRequestCommandPlan
  | ProviderNoopCommandPlan;

export interface ProviderPostInitializeRequest {
  plan: ProviderRequestCommandPlan;
  required: boolean;
  onResult(result: unknown): void;
}

export type ProviderInteractiveResponse =
  | boolean
  | number
  | string
  | null
  | ProviderInteractiveResponse[]
  | { [key: string]: ProviderInteractiveResponse | undefined };

export interface DecodedToolCallRequest {
  requestId: string | number;
  providerThreadId: string;
  /**
   * Non-empty BB turn id when known. Use null as the canonical unresolved
   * value so the runtime can resolve from the active turn; empty strings are
   * malformed adapter output.
   */
  turnId: string | null;
  callId: string;
  tool: string;
  arguments?: unknown;
  threadId?: string;
}

export interface DecodedInteractiveRequest {
  requestId: string | number;
  method: string;
  providerThreadId: string;
  /**
   * Non-empty BB turn id when known. Use null as the canonical unresolved
   * value so the runtime can resolve from the active turn; empty strings are
   * malformed adapter output.
   */
  turnId: string | null;
  payload: PendingInteractionPayload;
  threadId?: string;
}

export interface PreparedProviderCommandDispatch {
  rollback(): void;
  /**
   * Claims the prepared correlation if no provider event has consumed it yet,
   * proving this dispatch still owns unstarted work. Returns true (and drops
   * the correlation, so nothing can consume it twice) when the provider never
   * started a turn for this dispatch; false once it did. Callers use it to
   * settle a prompt the provider accepted and finished without emitting any
   * turn activity, without fabricating a turn from a late signal.
   */
  claim(): boolean;
}

export interface BuildInteractiveResponseArgs {
  request: DecodedInteractiveRequest;
  resolution: PendingInteractionResolution;
}

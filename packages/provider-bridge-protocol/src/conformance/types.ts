/**
 * Transport abstraction the conformance kit drives. Black-box at the message
 * level: lines in, JSON-RPC messages out. Two expected implementations — an
 * in-process bridge (`send` = the bridge's exported line handler,
 * `takeMessages` drains a captured-output buffer) and a spawned bridge binary
 * (stdin write + stdout readline). The kit never sees which.
 */
export interface BridgeConformanceTransport {
  /** Deliver one raw line to the bridge. */
  send(line: string): void;
  /** Drain every message the bridge emitted since the last call. */
  takeMessages(): unknown[];
  close?(): Promise<void> | void;
}

/**
 * The kit-internal assembled-event lane. The wire carries `thread/delta`, but
 * the grammar checks run over canonical `ThreadEvent`s, so a conformance
 * transport assembles the bridge's deltas (through the runtime's real delta
 * assembler) and re-emits each assembled event as a notification with this
 * method and `{ threadId, event }` params. It is not a protocol method — it
 * exists only between a conformance transport and this kit.
 */
export const CONFORMANCE_ASSEMBLED_EVENT_METHOD = "conformance/assembledEvent";

export type ConformanceStatus = "pass" | "fail" | "skipped";

export interface ConformanceCheckResult {
  /** Stable rule id, e.g. "rpc/unknown-method". */
  id: string;
  title: string;
  status: ConformanceStatus;
  /** Failure or skip explanation; empty on pass. */
  detail: string;
}

export interface ConformanceReport {
  results: ConformanceCheckResult[];
  passed: boolean;
}

export function reportPassed(results: ConformanceCheckResult[]): boolean {
  return results.every((result) => result.status === "pass");
}

/**
 * Transport abstraction the conformance kit drives. Black-box at the message
 * level: lines in, JSON-RPC messages out. Two expected implementations — an
 * in-process bridge (`send` = the bridge's exported line handler,
 * `takeMessages` = the captured output's drain) and a spawned bridge binary
 * (stdin write + stdout readline). The kit never sees which: it assembles
 * the bridge's `thread/delta` notifications itself, through the runtime's
 * real delta assembler, so the transport hands over raw wire messages only.
 */
export interface BridgeConformanceTransport {
  /** Deliver one raw line to the bridge. */
  send(line: string): void;
  /**
   * Every JSON-RPC message the bridge emitted since the last call, in order:
   * responses, notifications (`thread/delta` included) and bridge-initiated
   * requests, as parsed JSON.
   */
  takeMessages(): unknown[];
  close?(): Promise<void> | void;
}

/**
 * Retired. The kit once read its canonical events from a notification the
 * transport assembled under this method; it now assembles `thread/delta`
 * itself and reads nothing under this name. Kept because SDK 0.4.x published
 * it from `@get-bb/plugin-sdk/provider-bridge/testing`; removed at the next
 * major version.
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

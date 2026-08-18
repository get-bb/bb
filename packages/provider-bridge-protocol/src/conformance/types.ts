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

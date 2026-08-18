import { ConformanceClient } from "./client.js";
import {
  runHandshakeScenario,
  runRpcHygieneScenarios,
  runSessionLifecycleScenarios,
  type ConformanceSessionFixture,
} from "./scenarios.js";
export { checkItemOpensBeforeDelta } from "./scenarios.js";
import {
  reportPassed,
  type BridgeConformanceTransport,
  type ConformanceCheckResult,
  type ConformanceReport,
} from "./types.js";
export { CONFORMANCE_ASSEMBLED_EVENT_METHOD } from "./types.js";

export type {
  BridgeConformanceTransport,
  ConformanceCheckResult,
  ConformanceReport,
  ConformanceSessionFixture,
};
export { ConformanceClient } from "./client.js";

export interface RunBridgeConformanceOptions {
  transport: BridgeConformanceTransport;
  session: ConformanceSessionFixture;
  /** Per-wait timeout. Conformant bridges answer fast; keep this tight. */
  timeoutMs?: number;
}

/**
 * Drive one bridge through the conformance scenarios: JSON-RPC hygiene, the
 * initialize handshake, then a shared session lifecycle (start → turn →
 * grammar checks → release stop → resume → id-uniqueness). One transport for
 * the whole run, mirroring a real bridge lifetime.
 *
 * Against a conformant bridge every result passes. Against a bridge that is
 * not yet protocol-pure, the failures ARE the migration work list — run it
 * before migrating and pin the report, then make it shrink.
 */
export async function runBridgeConformance(
  options: RunBridgeConformanceOptions,
): Promise<ConformanceReport> {
  const client = new ConformanceClient(
    options.transport,
    options.timeoutMs ?? 5_000,
  );

  const results: ConformanceCheckResult[] = [];
  results.push(...(await runRpcHygieneScenarios(client)));
  results.push(...(await runHandshakeScenario(client)));
  results.push(
    ...(await runSessionLifecycleScenarios({
      client,
      fixture: options.session,
    })),
  );

  await options.transport.close?.();
  return { results, passed: reportPassed(results) };
}

/** Compact single-line-per-rule rendering for test snapshots and logs. */
export function formatConformanceReport(report: ConformanceReport): string {
  return report.results
    .map(
      (result) =>
        `${result.status.padEnd(7)} ${result.id}${
          result.detail === "" ? "" : ` — ${result.detail}`
        }`,
    )
    .join("\n");
}

import { createBridgeDeltaEventCollector } from "../testing/bridge-delta-assembly.js";
import { ConformanceClient } from "./client.js";
import {
  runHandshakeScenario,
  runRpcHygieneScenarios,
  runSessionLifecycleScenarios,
  type ConformanceSessionFixture,
} from "./scenarios.js";
export {
  checkItemOpensBeforeDelta,
  checkPresentationIconsDeclared,
} from "./scenarios.js";
export {
  checkRecordedCellReplay,
  RECORDED_CONFORMANCE_CELLS,
  type RecordedCellReplay,
  type RecordedConformanceCell,
} from "./recorded.js";
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
  /**
   * The provider id the bridge's plugin registers. The kit assembles the
   * bridge's `thread/delta` stream through the runtime's real delta
   * assembler, and the canonical events it builds carry this id, as the
   * runtime's would.
   */
  providerId: string;
  /** Per-wait timeout. Conformant bridges answer fast; keep this tight. */
  timeoutMs?: number;
}

/**
 * Drive one bridge through the conformance scenarios: JSON-RPC hygiene, the
 * initialize handshake, then a shared session lifecycle (start → turn →
 * grammar checks → release stop → resume with its identity → id-uniqueness
 * → fork with its identity when the handshake declares fork → the opt-in
 * rules), released at the end the way the runtime releases a thread it
 * detaches. One transport for the whole run, mirroring a real bridge
 * lifetime.
 *
 * Against a conformant bridge every result passes. Against a bridge that is
 * not yet protocol-pure, the failures ARE the migration work list — run it
 * before migrating and pin the report, then make it shrink.
 */
export async function runBridgeConformance(
  options: RunBridgeConformanceOptions,
): Promise<ConformanceReport> {
  const collector = createBridgeDeltaEventCollector(options.providerId);
  const client = new ConformanceClient(
    options.transport,
    options.timeoutMs ?? 5_000,
    collector,
  );

  const results: ConformanceCheckResult[] = [];
  results.push(...(await runRpcHygieneScenarios(client)));
  const handshake = await runHandshakeScenario(client);
  results.push(...handshake.results);
  results.push(
    ...(await runSessionLifecycleScenarios({
      client,
      fixture: options.session,
      // The same reverse mapping the runtime applies when it names a turn
      // to the bridge: the assembler's provider↔bb turn-id map.
      resolveProviderTurnId: (threadId, bbTurnId) =>
        collector.assembler.getProviderTurnId(threadId, bbTurnId),
      // A failed handshake reads as the definite absences the schema
      // defaults to: no fork, so the fork rule is not attempted.
      fork: handshake.capabilities?.fork ?? "none",
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

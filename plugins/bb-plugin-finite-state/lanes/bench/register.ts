import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { PluginContext } from "../../lib/context.js";
import { rpcContract } from "../../shared/contract.js";
import { createBenchHostJoinCode, listBenchHosts } from "./execute/hosts.js";
import { runBenchJobService } from "./execute/jobs.js";
import { runBench } from "./execute/run.js";
import { listBenchArtifacts } from "./store/artifacts.js";
import { listBenchAttestations } from "./store/attestations.js";
import { listBenchResults, storeEvidenceCheckpointWithResult } from "./store/results.js";
import { getBenchRun, listBenchRuns } from "./store/runs.js";
import type { BenchEvidenceBundle } from "./store/types.js";
import { getOtaVerdict } from "./verdict/query.js";

const benchRpcContract = {
  benchRunsList: rpcContract.benchRunsList,
  benchRunGet: rpcContract.benchRunGet,
  benchLogsList: rpcContract.benchLogsList,
  benchVerdictGet: rpcContract.benchVerdictGet,
  benchRunStart: rpcContract.benchRunStart,
  benchHostsList: rpcContract.benchHostsList,
  benchHostsJoinCode: rpcContract.benchHostsJoinCode,
} as const;

function notImplementedHttp(owner: "WP-54"): Response {
  return Response.json(
    { error: { code: "NOT_IMPLEMENTED", message: `${owner} owns this bench stream` } },
    { status: 501 },
  );
}

export interface BenchCommandServices {
  storeEvidenceCheckpoint(bundle: BenchEvidenceBundle): void;
  runBench: typeof runBench;
}

export function createBenchCommandServices(
  bb: BbPluginApi,
  db: Database.Database,
): BenchCommandServices {
  return {
    storeEvidenceCheckpoint(bundle) {
      const change = storeEvidenceCheckpointWithResult(db, bundle);
      if (change.changed) {
        bb.realtime.publish("bench:changed", {
          runId: change.runId,
          status: change.status,
        });
      }
    },
    runBench,
  };
}

export function registerBench(bb: BbPluginApi, ctx: PluginContext): void {
  const db = ctx.db();
  ctx.service("bench.command-services", () => createBenchCommandServices(bb, db));

  bb.rpc.register(benchRpcContract, {
    benchRunsList(input) {
      const page = listBenchRuns(db, {
        projectId: input.projectId,
        pvId: input.projectVersionId,
        pageSize: input.pageSize,
        continuation: input.continuation,
      });
      return {
        items: page.items.map((run) => ({
          projectId: run.projectId,
          projectVersionId: run.pvId,
          kind: "verificationRun",
          key: run.runId,
          label: `${run.tier} ${run.status}`,
          fields: {
            tier: run.tier,
            matrixTier: run.matrixTier,
            status: run.status,
            target: run.target,
            firmwareDigest: run.firmwareDigest,
            jobId: run.jobId,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            syncedAt: run.syncedAt,
          },
        })),
        total: page.total,
        next: page.next,
        cache: page.cache,
      };
    },
    benchRunGet(input) {
      const detail = getBenchRun(db, {
        projectId: input.projectId,
        pvId: input.projectVersionId,
        runId: input.runId,
      });
      if (!detail) throw new Error(`BENCH_RUN_NOT_FOUND: ${input.runId}`);
      const pageQuery = {
        projectId: input.projectId,
        pvId: input.projectVersionId,
        runId: input.runId,
        pageSize: 50,
        continuation: null,
      } as const;
      const results = listBenchResults(db, pageQuery);
      const artifacts = listBenchArtifacts(db, pageQuery);
      const attestations = listBenchAttestations(db, pageQuery);
      return {
        projectId: detail.run.projectId,
        projectVersionId: detail.run.pvId,
        kind: "verificationRun",
        key: detail.run.runId,
        label: `${detail.run.tier} ${detail.run.status}`,
        fields: {
          tier: detail.run.tier,
          matrixTier: detail.run.matrixTier,
          status: detail.run.status,
          target: detail.run.target,
          firmwareDigest: detail.run.firmwareDigest,
          jobId: detail.run.jobId,
          startedAt: detail.run.startedAt,
          finishedAt: detail.run.finishedAt,
          results: results.items,
          resultsTotal: results.total,
          resultsNext: results.next,
          artifacts: artifacts.items,
          artifactsTotal: artifacts.total,
          artifactsNext: artifacts.next,
          attestations: attestations.items,
          attestationsTotal: attestations.total,
          attestationsNext: attestations.next,
        },
        links: [],
        cache: detail.cache,
      };
    },
    benchLogsList() {
      throw new Error("NOT_IMPLEMENTED: WP-54 owns paged bench logs");
    },
    benchVerdictGet() {
      return getOtaVerdict();
    },
    benchRunStart() {
      return runBench();
    },
    benchHostsList() {
      return listBenchHosts();
    },
    benchHostsJoinCode() {
      return createBenchHostJoinCode();
    },
  });

  bb.http.route("GET", "/bench/runs/log", () => notImplementedHttp("WP-54"));
  bb.http.route("GET", "/bench/runs/artifact", () => notImplementedHttp("WP-54"));
  bb.http.route("GET", "/bench/runs/attestation", () => notImplementedHttp("WP-54"));
  bb.background.service("bench-jobs", { start: runBenchJobService });
}

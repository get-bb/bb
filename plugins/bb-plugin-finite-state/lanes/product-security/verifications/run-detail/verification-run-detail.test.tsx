// @vitest-environment jsdom
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { installTestPluginRuntime, renderSlot } from "@bb/plugin-sdk/testing/app";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { registerRemoteServices } from "../../../remote/register.js";
import { registerVerificationRunDetailBackend } from "./backend.js";
import { queryResultHistory, queryRunDetail } from "./query.js";
import { AttestationCard } from "./AttestationCard.js";
import { runVerification, type VerificationJob } from "./actions.js";
import { RunDetail, type RunDetailModel } from "./RunDetail.js";
import type { ProductSecurityFeatures } from "../../ui/ProductSecurityPanel.js";

let VerificationRunDetailLayer: typeof import("./index.js").VerificationRunDetailLayer;
let ProductSecurityPanel: typeof import("../../ui/ProductSecurityPanel.js").ProductSecurityPanel;

beforeAll(async () => {
  installTestPluginRuntime();
  ({ VerificationRunDetailLayer } = await import("./index.js"));
  ({ ProductSecurityPanel } = await import("../../ui/ProductSecurityPanel.js"));
});

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
afterEach(async () => { cleanup(); await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose())); });

const EMPTY_MODEL: RunDetailModel = {
  requirementId: "REQ-EMPTY", tier: "static", run: null, checks: [], history: [],
  historyTotal: 0, historyNext: null, artifacts: [], attestations: [],
  manualMessage: "Manual evidence is unavailable.",
  taraConcurrency: "Head-only concurrency bracket.",
};

function detailPanel(): { component(): React.JSX.Element } {
  return { component: () => <VerificationRunDetailLayer detail={["REQ-1", "static"]} projectId="project-1" /> };
}

function productPanel() {
  const EmptyLayer = () => null;
  const features: ProductSecurityFeatures = {
    loadNodeTypes: async () => ({}), edgeTypes: {}, ThreatOverlay: EmptyLayer,
    LinksLayer: EmptyLayer, EditingLayer: EmptyLayer, RequirementsCards: EmptyLayer,
    RequirementsTraceabilityLayer: EmptyLayer, RequirementsConversionLayer: EmptyLayer,
    VerificationMatrix: () => <p>Matrix route</p>,
    VerificationRunDetailLayer: ({ detail }) => <p>Detail route {detail?.join("/")}</p>,
  };
  return { component: (props: { subPath: string }) => <ProductSecurityPanel features={features} {...props} /> };
}

function fixture() {
  const host = createFakePluginHost({ pluginId: `finite-state-wp40-${hosts.length}` }); hosts.push(host);
  const ctx = createPluginContext(host.bb); const db = ctx.db();
  const project = "project-1", version = "version-1", generation = "generation-1", at = "2026-08-13T12:00:00.000Z";
  db.prepare(`INSERT INTO pull_generation (project_id,project_version_id,generation_id,status,requested_kinds_json,started_at,completed_at,accepted_at) VALUES (?,?,?,'accepted','["requirement","verificationRun"]',?,?,?)`).run(project, version, generation, at, at, at);
  for (const kind of ["requirement", "verificationRun"]) db.prepare(`INSERT INTO sync_state (project_id,project_version_id,entity_kind,accepted_generation_id,base_revision,last_pull) VALUES (?,?,?, ?,0,?)`).run(project, version, kind, generation, at);
  db.prepare(`INSERT INTO verification_checks (project_id,project_version_id,generation_id,check_id,code,name,check_type,pass_criteria,fail_criteria,review_version,raw,pulled_at) VALUES (?,?,?,'check-1','CHK-1','Secure boot','binary_analysis','signature valid','signature invalid','4','{}',?)`).run(project, version, generation, at);
  db.prepare(`INSERT INTO requirement_check_mappings (project_id,project_version_id,generation_id,requirement_key,check_id,is_required,coverage_level,suppressed,raw,pulled_at) VALUES (?,?,?,'REQ-1','check-1',1,'full',0,'{}',?)`).run(project, version, generation, at);
  db.prepare(`INSERT INTO verification_runs (project_id,project_version_id,generation_id,run_id,tier,matrix_col,kind,status,firmware_digest,log_locator,raw,synced_at) VALUES (?,?,?,'run-1','tier0','static','platform','completed',?,'logical/run.log',?,?)`).run(project, version, generation, "a".repeat(64), JSON.stringify({ jobs: [{ logTail: ["line one", "line two"] }] }), at);
  const insertResult = db.prepare(`INSERT INTO verification_results (project_id,project_version_id,generation_id,result_id,run_id,requirement_key,check_id,tier,status,outcome,confidence,evidence_summary,executed_at,failure_reason,remediation_suggestion,fs_version_name,is_latest,superseded_by,mapping_state,raw,pulled_at) VALUES (?,?,?,?,?,'REQ-1','check-1','static',?,?,?,?,?,?,?,?,?,?, 'mapped','{}',?)`);
  insertResult.run(project, version, generation, "result-new", "run-1", "verified", "pass", "high", "signature verified", "2026-08-13T12:00:00.000Z", null, null, "fw-2", 1, null, at);
  insertResult.run(project, version, generation, "result-old", "run-1", "failed", "fail", "high", "signature missing", "2026-08-12T12:00:00.000Z", "missing signature", "sign image", "fw-1", 0, "result-new", at);
  db.prepare(`INSERT INTO verification_artifacts (project_id,project_version_id,generation_id,artifact_id,run_id,name,kind,locator,sha256,bytes,pulled_at) VALUES (?,?,?,'artifact-1','run-1','report.json','report','runs/run-1/report.json',?,42,?)`).run(project, version, generation, "b".repeat(64), at);
  const insertAttestation = db.prepare(`INSERT INTO attestations (project_id,project_version_id,generation_id,attestation_id,run_id,format,subject_digest,evidence_digest,signer_identity,payload,signature_verified,subject_matches_run,verified,created_at,pulled_at) VALUES (?,?,?,?,'run-1','dsse',?,?,'builder@example.com',?,1,?,?,?,?)`);
  insertAttestation.run(project, version, generation, "att-valid", "a".repeat(64), "b".repeat(64), JSON.stringify({ signature: "signed-valid" }), 1, 1, at, at);
  insertAttestation.run(project, version, generation, "att-wrong", "c".repeat(64), "d".repeat(64), JSON.stringify({ signature: "signed-wrong" }), 0, 0, at, at);
  return { host, ctx, db, project, version };
}

describe("verification run detail", () => {
  it("renders loading, populated, empty-evidence, and retained-data error states", async () => {
    const pending = renderSlot(detailPanel(), {}, { rpc: { verificationsRunGet: () => new Promise(() => undefined) } });
    expect(pending.getByLabelText("Loading verification run detail")).toBeTruthy();
    pending.lifecycle.unmount();

    const { db, project, version } = fixture();
    const populatedModel = queryRunDetail(db, { projectId: project, projectVersionId: version, requirementId: "REQ-1", tier: "static" });
    let calls = 0;
    const populated = renderSlot(detailPanel(), {}, { rpc: {
      verificationsRunGet: () => {
        calls += 1;
        if (calls > 1) throw new Error("Scoped detail refresh failed");
        return populatedModel;
      },
      verificationResultHistoryList: () => queryResultHistory(db, { projectId: project, projectVersionId: version, requirementId: "REQ-1", tier: "static", pageSize: 50, continuation: null }),
      verificationsRunStart: () => { throw new Error("not invoked"); },
    } });
    expect(await populated.findByText("Signed attestations")).toBeTruthy();
    expect(populated.getByText("Secure boot")).toBeTruthy();
    await populated.behavior.emitRealtime("verifications:changed", { projectId: project });
    await waitFor(() => expect(populated.getByText(/Scoped detail refresh failed.*Cached evidence remains visible/u)).toBeTruthy());
    expect(populated.getByText("Secure boot")).toBeTruthy();
    populated.lifecycle.unmount();

    const empty = render(<RunDetail error={null} jobState={null} loadingHistory={false} model={EMPTY_MODEL} onLoadMore={() => undefined} onRetry={() => undefined} onRun={() => undefined} projectId="project-1" running={false} />);
    expect(empty.getByText("No runs")).toBeTruthy();
    expect(empty.getByText("No signed evidence is cached for this run.")).toBeTruthy();
  });

  it("routes only recognized requirement/tier details and keeps unknown routes on the matrix", () => {
    const options = { context: { projectId: "project-1", threadId: null }, sidebarThreads: { status: "ready" as const, projects: [], threads: [] } };
    const detail = renderSlot(productPanel(), { subPath: "verifications/REQ-1/static" }, options);
    expect(detail.getByText("Detail route REQ-1/static")).toBeTruthy();
    expect(detail.queryByText("Matrix route")).toBeNull();
    detail.lifecycle.unmount();

    const unknown = renderSlot(productPanel(), { subPath: "verifications/REQ-1/unrecognized" }, options);
    expect(unknown.getByText("Matrix route")).toBeTruthy();
    expect(unknown.queryByText(/Detail route/u)).toBeNull();
    unknown.lifecycle.unmount();

    const unconfigured = renderSlot(productPanel(), { subPath: "verifications/REQ-1/static" }, { context: { projectId: null, threadId: null }, sidebarThreads: { status: "ready", projects: [], threads: [] } });
    expect(unconfigured.getByText("Choose a project")).toBeTruthy();
    unconfigured.lifecycle.unmount();
  });

  it("returns newest-first history with cursor-free totals and explicit supersession", () => {
    const { db, project, version } = fixture();
    const first = queryResultHistory(db, { projectId: project, projectVersionId: version, requirementId: "REQ-1", tier: "static", pageSize: 1, continuation: null });
    expect(first.total).toBe(2); expect(first.items[0]?.key).toBe("result-new"); expect(first.next).not.toBeNull();
    const second = queryResultHistory(db, { projectId: project, projectVersionId: version, requirementId: "REQ-1", tier: "static", pageSize: 1, continuation: first.next });
    expect(second.total).toBe(2); expect(second.items[0]?.fields).toMatchObject({ id: "result-old", isLatest: false, supersededBy: "result-new" });
  });

  it("never treats a valid signature bound to the wrong firmware as valid evidence", () => {
    const { db, project, version } = fixture();
    const detail = queryRunDetail(db, { projectId: project, projectVersionId: version, requirementId: "REQ-1", tier: "static" });
    const attestations = detail.fields.attestations;
    expect(attestations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "att-valid", verification: "valid", boundToCurrentFirmware: true }),
      expect.objectContaining({ id: "att-wrong", verification: "invalid", boundToCurrentFirmware: false }),
    ]));
    const view = render(<AttestationCard attestation={{ id: "wrong", runId: "run-1", firmwareDigest: "c".repeat(64), evidenceDigest: "d".repeat(64), signer: "builder", signature: "valid-signature", signedAt: "now", verification: "valid", boundToCurrentFirmware: false }} />);
    expect(view.getByText(/not bound to this run/i)).toBeTruthy(); expect(view.queryByText("Valid evidence")).toBeNull();
  });

  it("serves large logs through authenticated HTTP with byte ranges and confines artifacts", async () => {
    const { host, ctx, project } = fixture();
    await registerRemoteServices(host.bb, ctx); registerVerificationRunDetailBackend(host.bb, ctx);
    const response = await host.harness.behavior.fetchHttp("GET", `/product-security/verifications/log?projectId=${project}&runId=run-1`, { headers: { range: "bytes=0-7" } });
    expect(response.status).toBe(206); expect(response.headers.get("content-range")).toBe("bytes 0-7/18"); expect(await response.text()).toBe("line one");
    const traversal = await host.harness.behavior.fetchHttp("GET", `/product-security/verifications/artifact?projectId=${project}&runId=run-1&artifactName=..%2Fsecret`);
    expect(traversal.status).toBe(400);
    const unavailable = await host.harness.behavior.fetchHttp("GET", `/product-security/verifications/artifact?projectId=${project}&runId=run-1&artifactName=report.json`);
    expect(unavailable.status).toBe(410); expect(await unavailable.text()).toContain("no approved byte adapter");
  });

  it.each([
    ["COMPLETED", "COMPLETED"], ["FAILED", "FAILED"], ["TIMEOUT", "TIMEOUT"],
  ] as const)("terminates a platform job at %s", async (remoteStatus, expected) => {
    const jobs: VerificationJob[] = [];
    for await (const job of runVerification({ projectId: "p1", client: { async runVerificationChecks() { return { runId: "job-1", checksQueued: 1, status: remoteStatus }; } }, maxPolls: 1, sleep: async () => undefined }, { requirementId: "REQ-1", checkId: "check-1" })) jobs.push(job);
    expect(jobs.at(-1)?.state).toBe(expected);
  });

  it("polls cached truth and times out without claiming cancellation or success", async () => {
    const states = ["RUNNING" as const, null]; const jobs: VerificationJob[] = [];
    for await (const job of runVerification({ projectId: "p1", client: { async runVerificationChecks() { return { runId: "job-2", checksQueued: 1, status: "queued" }; } }, async readJob() { return states.shift() ?? null; }, maxPolls: 2, sleep: async () => undefined }, { requirementId: "REQ-1", checkId: "check-1" })) jobs.push(job);
    expect(jobs.map((job) => job.state)).toEqual(["QUEUED", "RUNNING", "TIMEOUT"]);
  });
});

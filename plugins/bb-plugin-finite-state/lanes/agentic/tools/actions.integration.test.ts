import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { createPluginContext } from "../../../lib/context.js";
import {
  ActionServiceError,
  BENCH_ACTION_SERVICE,
  FIRMWARE_ACTION_SERVICE,
  VERIFICATION_ACTION_SERVICE,
  type ScopedBenchAction,
  type ScopedFirmwareAction,
  type ScopedVerificationAction,
} from "../../../lib/agentic/action-allowlist.js";
import { registerActionTools } from "./actions.js";
import { registerVerificationAgentAction } from "../../product-security/verifications/run-detail/agent-action.js";
import { registerFirmwareAgentAction } from "../../firmware/agent-action.js";
import { FirmwareCacheError } from "../../firmware/cache/layout.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
afterEach(async () => Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose())));

describe("action tool production registrations", () => {
  it("executes all three through the harness with audit logs, hints, and no authored-model writes", async () => {
    const host = createFakePluginHost({ pluginId: `fs-action-integration-${crypto.randomUUID()}` });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    const verification = vi.fn(async () => ({ jobId: "job-1", runId: "run-1" }));
    const bench = vi.fn(async () => ({ runId: "bench-1", threadId: "bench-thread", status: "running" as const }));
    const firmware = vi.fn(async () => ({ pvId: "pv-1", source: "api" as const, hydrated: 1, remaining: 0, errors: 0 }));
    ctx.service<ScopedVerificationAction>(VERIFICATION_ACTION_SERVICE, () => ({ run: verification }));
    ctx.service<ScopedBenchAction>(BENCH_ACTION_SERVICE, () => ({ run: bench }));
    ctx.service<ScopedFirmwareAction>(FIRMWARE_ACTION_SERVICE, () => ({ materialize: firmware }));
    const before = Number(ctx.db().prepare("SELECT COUNT(*) FROM base_snapshot").pluck().get());
    registerActionTools(host.bb, ctx);

    await host.harness.behavior.callAgentTool("fs_verification_run", { requirement: "REQ-1", check: "CHECK-1" });
    await host.harness.behavior.callAgentTool("fs_bench_run", { pvId: "pv-1", tier: "tier0" });
    await host.harness.behavior.callAgentTool("fs_firmware_materialize", { pvId: "pv-1", mode: "manifest" });

    expect(verification).toHaveBeenCalledTimes(1);
    expect(bench).toHaveBeenCalledTimes(1);
    expect(firmware).toHaveBeenCalledTimes(1);
    expect(host.harness.inspection.realtimeSignals.map((signal) => signal.channel)).toEqual(expect.arrayContaining([
      "bench:changed", "firmware:changed",
    ]));
    expect(host.harness.inspection.logEntries.filter((entry) => entry.message.includes("finite_state_agent_action"))).toHaveLength(6);
    expect(Number(ctx.db().prepare("SELECT COUNT(*) FROM base_snapshot").pluck().get())).toBe(before);
  });

  it("does not duplicate an ambiguous non-idempotent dispatch", async () => {
    const host = createFakePluginHost({ pluginId: `fs-action-ambiguity-${crypto.randomUUID()}` });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    const bench = vi.fn(async () => {
      throw new ActionServiceError(
        "bench_dispatch_ambiguous",
        "A remote job may have started",
        "dispatch_ambiguous",
        { runId: "bench-durable-1", threadId: "bench-thread-1" },
      );
    });
    ctx.service<ScopedBenchAction>(BENCH_ACTION_SERVICE, () => ({ run: bench }));
    registerActionTools(host.bb, ctx);
    const result = await host.harness.behavior.callAgentTool("fs_bench_run", { pvId: "pv-1", tier: "tier1", requirement: "REQ-1", target: "CVE-1@component-1" });
    expect(JSON.stringify(result)).toMatch(/bench-durable-1.*do not dispatch/iu);
    expect(bench).toHaveBeenCalledTimes(1);
  });

  it("fails an untyped bench error closed with explicit unknown liveness", async () => {
    const host = createFakePluginHost({ pluginId: `fs-action-unknown-${crypto.randomUUID()}` });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    const bench = vi.fn(async () => { throw new Error("FORGE_PENTEST_INVALID_JOB"); });
    ctx.service<ScopedBenchAction>(BENCH_ACTION_SERVICE, () => ({ run: bench }));
    registerActionTools(host.bb, ctx);
    const result = await host.harness.behavior.callAgentTool("fs_bench_run", {
      pvId: "pv-1", tier: "tier1", requirement: "REQ-1", target: "CVE-1@component-1",
    });
    expect(JSON.stringify(result)).toMatch(/bench_dispatch_ambiguous.*liveness is unknown.*Do not retry/iu);
    expect(bench).toHaveBeenCalledTimes(1);
  });

  it("uses the verification owner adapter's accepted-generation, tier, and ambiguity mapping", async () => {
    const host = createFakePluginHost({ pluginId: `fs-verification-adapter-${crypto.randomUUID()}` });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    const db = ctx.db();
    const at = "2026-08-13T12:00:00.000Z";
    for (const [generation, status] of [["generation-stale", "superseded"], ["generation-accepted", "accepted"]] as const) {
      db.prepare(`INSERT INTO pull_generation
        (project_id, project_version_id, generation_id, status, requested_kinds_json, started_at)
        VALUES ('project-test', 'pv-1', ?, ?, '["requirement","verificationCheck"]', ?)`)
        .run(generation, status, at);
    }
    db.prepare(`INSERT INTO sync_state
      (project_id, project_version_id, entity_kind, accepted_generation_id)
      VALUES ('project-test', 'pv-1', 'requirement', 'generation-accepted')`).run();
    const insertCheck = db.prepare(`INSERT INTO verification_checks
      (project_id, project_version_id, generation_id, check_id, code, name,
       check_type, review_version, raw, pulled_at)
      VALUES ('project-test', 'pv-1', ?, ?, ?, ?, ?, '0', '{}', ?)`);
    const insertMapping = db.prepare(`INSERT INTO requirement_check_mappings
      (project_id, project_version_id, generation_id, requirement_key, check_id, raw, pulled_at)
      VALUES ('project-test', 'pv-1', ?, 'REQ-1', ?, '{}', ?)`);
    insertCheck.run("generation-stale", "check-stale", "STALE", "Stale", "SAST", at);
    insertMapping.run("generation-stale", "check-stale", at);
    insertCheck.run("generation-accepted", "check-static", "STATIC", "Static", "SAST", at);
    insertMapping.run("generation-accepted", "check-static", at);
    const runVerificationChecks = vi.fn(async () => ({ runId: "verification-job-1", checksQueued: 1, status: "QUEUED" }));
    registerVerificationAgentAction(ctx, { runVerificationChecks });
    const service = ctx.service<ScopedVerificationAction>(VERIFICATION_ACTION_SERVICE, () => { throw new Error("missing verification action"); });
    const scope = { projectId: "project-test", threadId: "thread-test", signal: new AbortController().signal };

    await expect(service.run({ requirement: "REQ-1", tier: "static" }, scope))
      .resolves.toEqual({ jobId: "verification-job-1" });
    expect(runVerificationChecks).toHaveBeenCalledWith({
      projectId: "project-test", checkIds: ["check-static"], rerunPassed: true,
    });
    expect(host.harness.inspection.realtimeSignals.map((signal) => signal.channel))
      .toContain("verifications:changed");

    insertCheck.run("generation-accepted", "check-static-2", "STATIC_2", "Static 2", "SCA", at);
    insertMapping.run("generation-accepted", "check-static-2", at);
    await expect(service.run({ requirement: "REQ-1", tier: "static" }, scope))
      .rejects.toMatchObject({ code: "VERIFICATION_CHECK_AMBIGUOUS", kind: "precondition" });
    expect(runVerificationChecks).toHaveBeenCalledTimes(1);
  });

  it("uses the firmware owner adapter for hydrate_all preflight and typed admin failure", async () => {
    const host = createFakePluginHost({ pluginId: `fs-firmware-adapter-${crypto.randomUUID()}` });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    const db = ctx.db();
    const at = "2026-08-13T12:00:00.000Z";
    db.prepare(`INSERT INTO pull_generation
      (project_id, project_version_id, generation_id, status, requested_kinds_json, started_at)
      VALUES ('project-test', 'pv-ready', 'generation-ready', 'accepted', '["firmware"]', ?),
             ('project-test', 'pv-api', 'generation-api', 'accepted', '["firmware"]', ?)`)
      .run(at, at);
    db.prepare(`INSERT INTO firmware_mounts
      (project_id, project_version_id, generation_id, source, state, root_path,
       file_count, materialized_files, error_count, pulled_at)
      VALUES ('project-test', 'pv-ready', 'generation-ready', 'standalone_unpack', 'ready', '/rootfs/ready', 2, 2, 0, ?),
             ('project-test', 'pv-api', 'generation-api', 'api', 'metadata_only', '/rootfs/api', 2, 0, 0, ?)`)
      .run(at, at);
    const materializeApi = vi.fn(async () => {
      throw new FirmwareCacheError(
        "FIRMWARE_ADMIN_BYTES_REQUIRED",
        "Firmware bytes require org-admin permission; metadata remains available",
      );
    });
    registerFirmwareAgentAction(ctx, { materializeApi });
    const service = ctx.service<ScopedFirmwareAction>(FIRMWARE_ACTION_SERVICE, () => { throw new Error("missing firmware action"); });
    const scope = { projectId: "project-test", threadId: "thread-test", signal: new AbortController().signal };

    await expect(service.materialize({ pvId: "pv-ready", mode: "hydrate_all" }, scope)).resolves.toEqual({
      pvId: "pv-ready", source: "standalone_unpack", hydrated: 2, remaining: 0, errors: 0,
    });
    await expect(service.materialize({ pvId: "pv-api", mode: "hydrate_all" }, scope))
      .rejects.toMatchObject({ code: "API_FULL_MATERIALIZATION_UNSUPPORTED", kind: "precondition" });
    await expect(service.materialize({ pvId: "pv-api", mode: "hydrate", paths: ["bin/app"] }, scope))
      .rejects.toMatchObject({ code: "firmware_admin_required", kind: "permission" });
    expect(materializeApi).toHaveBeenCalledTimes(1);
  });
});

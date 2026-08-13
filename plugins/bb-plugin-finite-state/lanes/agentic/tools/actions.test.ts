import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { createPluginContext } from "../../../lib/context.js";
import {
  BENCH_ACTION_SERVICE,
  FIRMWARE_ACTION_SERVICE,
  VERIFICATION_ACTION_SERVICE,
  type ScopedBenchAction,
  type ScopedFirmwareAction,
  type ScopedVerificationAction,
} from "../../../lib/agentic/action-allowlist.js";
import { registerActionTools } from "./actions.js";
import { registerBenchAgentAction } from "../../bench/agent-action.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

function fixture(services: {
  verification?: ScopedVerificationAction;
  bench?: ScopedBenchAction;
  firmware?: ScopedFirmwareAction;
} = {}) {
  const host = createFakePluginHost({ pluginId: `fs-actions-${crypto.randomUUID()}` });
  hosts.push(host);
  const ctx = createPluginContext(host.bb);
  if (services.verification) ctx.service(VERIFICATION_ACTION_SERVICE, () => services.verification!);
  if (services.bench) ctx.service(BENCH_ACTION_SERVICE, () => services.bench!);
  if (services.firmware) ctx.service(FIRMWARE_ACTION_SERVICE, () => services.firmware!);
  registerActionTools(host.bb, ctx);
  return { host, ctx };
}

function decoded(result: Awaited<ReturnType<ReturnType<typeof fixture>["host"]["harness"]["behavior"]["callAgentTool"]>>) {
  if (typeof result === "string") return JSON.parse(result) as unknown;
  const text = result.content.find((part) => part.type === "text")?.text;
  if (!text) throw new Error("tool returned no text");
  return JSON.parse(text) as unknown;
}

describe("action tools", () => {
  it("uses strict schemas and delegates each tool to only its narrow service", async () => {
    const verificationRun = vi.fn(async () => ({ jobId: "job-1", runId: "run-1" }));
    const benchRun = vi.fn(async () => ({ runId: "bench-1", threadId: "thread-1", status: "queued" as const }));
    const materialize = vi.fn(async () => ({ pvId: "pv-1", source: "api" as const, hydrated: 2, remaining: 3, errors: 0 }));
    const { host } = fixture({
      verification: { run: verificationRun },
      bench: { run: benchRun },
      firmware: { materialize },
    });

    await expect(host.harness.behavior.callAgentTool("fs_verification_run", {
      requirement: "REQ-1", check: "CHECK-1", unexpected: true,
    })).rejects.toThrow(/arguments are invalid/iu);
    expect(decoded(await host.harness.behavior.callAgentTool("fs_verification_run", {
      requirement: "REQ-1", check: "CHECK-1", tier: "static",
    }))).toMatchObject({ ok: true, data: { job_id: "job-1", status: "queued" } });
    expect(decoded(await host.harness.behavior.callAgentTool("fs_bench_run", {
      pvId: "pv-1", tier: "tier0",
    }))).toMatchObject({ ok: true, data: { run_id: "bench-1", thread_id: "thread-1" } });
    expect(decoded(await host.harness.behavior.callAgentTool("fs_firmware_materialize", {
      pvId: "pv-1", mode: "hydrate", paths: ["bin/app"],
    }))).toMatchObject({ ok: true, data: { source: "api", hydrated: 2, remaining: 3 } });
    expect(verificationRun).toHaveBeenCalledTimes(1);
    expect(benchRun).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
  });

  it("refuses an incomplete bench mount without retrying dispatch", async () => {
    const run = vi.fn(async () => { throw new Error("MOUNT_INCOMPLETE: fully materialized firmware is required"); });
    const { host } = fixture({ bench: { run } });
    expect(decoded(await host.harness.behavior.callAgentTool("fs_bench_run", {
      pvId: "pv-1", tier: "tier1", requirement: "REQ-1", target: "CVE-1@component-1",
    }))).toMatchObject({ ok: false, error: { code: "bench_action_failed", retryable: false } });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("owner-side bench preflight rejects incomplete firmware before remote dispatch", async () => {
    const host = createFakePluginHost({ pluginId: `fs-bench-preflight-${crypto.randomUUID()}` });
    hosts.push(host);
    host.harness.sdk.stub("threads.get", async () => ({
      id: "thread-test", projectId: "project-test", environmentId: "environment-test",
    }));
    host.harness.sdk.stub("environments.get", async () => ({
      id: "environment-test", projectId: "project-test", path: "/verified/worktree", hostId: "host-test",
    }));
    const ctx = createPluginContext(host.bb);
    const remote = vi.fn(() => { throw new Error("remote must not be reached"); });
    registerBenchAgentAction(ctx, remote, {
      enqueue: vi.fn(),
      take: vi.fn(async () => { throw new Error("job queue must not be reached"); }),
    });
    const service = ctx.service<ScopedBenchAction>(BENCH_ACTION_SERVICE, () => { throw new Error("missing bench action"); });
    await expect(service.run({ pvId: "pv-missing", tier: "tier1" }, {
      projectId: "project-test", threadId: "thread-test", signal: new AbortController().signal,
    })).rejects.toThrow(/MOUNT_INCOMPLETE/iu);
    expect(remote).not.toHaveBeenCalled();
    expect(host.harness.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("turns verification timeout into status-query recovery and never retries", async () => {
    const run = vi.fn(async () => { throw new Error("verification dispatch timeout with unknown outcome"); });
    const { host } = fixture({ verification: { run } });
    expect(decoded(await host.harness.behavior.callAgentTool("fs_verification_run", {
      requirement: "REQ-1", check: "CHECK-1",
    }))).toMatchObject({
      ok: false,
      error: { code: "verification_dispatch_ambiguous", hint: expect.stringMatching(/query.*status|query.*run/iu), retryable: false },
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("surfaces API 403 as metadata-only admin recovery", async () => {
    const materialize = vi.fn(async () => { throw new Error("403 VIEW_ANY_PROJECT_FILE admin permission required"); });
    const { host } = fixture({ firmware: { materialize } });
    expect(decoded(await host.harness.behavior.callAgentTool("fs_firmware_materialize", {
      pvId: "pv-1", mode: "hydrate", paths: ["bin/app"],
    }))).toMatchObject({
      ok: false,
      error: { code: "firmware_admin_required", hint: expect.stringMatching(/metadata.*standalone unpack.*admin/iu) },
    });
  });
});

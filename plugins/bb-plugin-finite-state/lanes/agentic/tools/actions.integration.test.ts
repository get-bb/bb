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
      "verifications:changed", "bench:changed", "firmware:changed",
    ]));
    expect(host.harness.inspection.logEntries.filter((entry) => entry.message.includes("finite_state_agent_action"))).toHaveLength(6);
    expect(Number(ctx.db().prepare("SELECT COUNT(*) FROM base_snapshot").pluck().get())).toBe(before);
  });

  it("does not duplicate an ambiguous non-idempotent dispatch", async () => {
    const host = createFakePluginHost({ pluginId: `fs-action-ambiguity-${crypto.randomUUID()}` });
    hosts.push(host);
    const ctx = createPluginContext(host.bb);
    const bench = vi.fn(async () => { throw new Error("connection reset after dispatch; outcome ambiguous"); });
    ctx.service<ScopedBenchAction>(BENCH_ACTION_SERVICE, () => ({ run: bench }));
    registerActionTools(host.bb, ctx);
    const result = await host.harness.behavior.callAgentTool("fs_bench_run", { pvId: "pv-1", tier: "tier1", requirement: "REQ-1", target: "CVE-1@component-1" });
    expect(JSON.stringify(result)).toMatch(/query.*status|query.*run/iu);
    expect(bench).toHaveBeenCalledTimes(1);
  });
});

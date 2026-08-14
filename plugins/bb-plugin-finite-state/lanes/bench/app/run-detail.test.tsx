// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";

const cache = {
  state: "fresh" as const,
  asOf: "2026-08-13T12:00:00.000Z",
  message: null,
  acceptedGenerationId: "g1",
  baseRevision: 1,
};

beforeAll(() => installTestPluginRuntime());
afterEach(() => cleanup());

function detail(state: "fresh" | "stale" = "fresh") {
  return {
    projectId: "p1",
    projectVersionId: "v1",
    kind: "verificationRun",
    key: "run-1",
    label: "tier0 completed",
    fields: {
      tier: "tier0",
      status: "completed",
      target: "REQ-1",
      firmwareDigest: "a".repeat(64),
      threadId: "thread-1",
      config: { mode: "static" },
      results: [
        {
          requirementId: "REQ-1",
          checkId: "CHECK-1",
          outcome: "pass",
          evidenceSummary: "Verified",
        },
      ],
      artifacts: [
        {
          name: "report.json",
          kind: "evidence",
          sha256: "b".repeat(64),
          bytes: 12,
        },
      ],
      attestations: [
        { format: "in-toto", subjectDigest: "a".repeat(64), verified: true },
      ],
    },
    links: [],
    cache: { ...cache, state, message: state === "stale" ? "cached" : null },
  };
}

function verdict() {
  return {
    pvId: "v1",
    firmwareDigest: "a".repeat(64),
    currentMountedDigest: "a".repeat(64),
    verdict: "INCONCLUSIVE",
    stale: false,
    required: 0,
    proven: 0,
    failed: 0,
    gaps: 0,
    evidence: [],
    issues: [
      {
        code: "MODEL_UNAVAILABLE",
        message: "The accepted requirement model is missing or invalid.",
      },
    ],
    computedAt: "2026-08-13T12:00:00.000Z",
  };
}

describe("RunDetail", () => {
  it("does not retain prior-scope detail after a scope load fails", async () => {
    const { RunDetail } = await import("./run-detail.js");
    const slot = renderSlot(
      {
        component: () => (
          <RunDetail projectId="p1" projectVersionId="v1" runId="run-1" />
        ),
      },
      {},
      {
        rpc: {
          benchRunGet: (input: unknown) => {
            if (
              typeof input === "object" &&
              input !== null &&
              Reflect.get(input, "projectVersionId") === "v2"
            ) {
              throw new Error(
                "Bench evidence requires an accepted verificationRun generation",
              );
            }
            return detail();
          },
          benchLogsList: () => ({ items: [], total: 0, next: null, cache }),
          benchOtaVerdictGet: verdict,
        },
      },
    );
    expect(await slot.findByText("run-1")).toBeTruthy();
    slot.lifecycle.rerender(
      <RunDetail projectId="p1" projectVersionId="v2" runId="run-1" />,
    );
    expect(await slot.findByText("Unknown bench run")).toBeTruthy();
    expect(
      slot.getByText(/not available in the selected bench scope/u),
    ).toBeTruthy();
    expect(slot.queryByText("Configuration")).toBeNull();
  });

  it("renders all evidence sections and self-fetches BenchRunCard by id", async () => {
    const { BenchRunCard } = await import("./bench-run-card.js");
    const slot = renderSlot(
      { component: () => <BenchRunCard id="run-1" /> },
      {},
      {
        context: { projectId: "p1" },
        rpc: {
          benchRunGet: (input: unknown) => {
            if (
              typeof input !== "object" ||
              input === null ||
              Reflect.get(input, "runId") !== "run-1"
            ) {
              throw new Error("BENCH_RUN_NOT_FOUND");
            }
            return detail();
          },
          benchLogsList: () => ({ items: [], total: 0, next: null, cache }),
          benchOtaVerdictGet: verdict,
        },
      },
    );
    expect(await slot.findByText("run-1")).toBeTruthy();
    expect(slot.getByText("Configuration")).toBeTruthy();
    expect(slot.getByText("Requirement and check results")).toBeTruthy();
    expect(slot.getByText("Cached log tail")).toBeTruthy();
    expect(slot.getByText("Artifacts")).toBeTruthy();
    expect(slot.getByText("Attestation")).toBeTruthy();
    expect(
      slot
        .getByRole("link", { name: "Download envelope" })
        .getAttribute("href"),
    ).toBe(
      "/api/v1/plugins/finite-state/http/bench/runs/attestation?projectId=p1&runId=run-1",
    );
    expect(await slot.findByText("Inconclusive")).toBeTruthy();
    // The log-tail fetch fires after the run detail renders; poll rather than
    // asserting synchronously, which raced under CI load.
    await waitFor(
      () => {
        expect(slot.inspection.rpcCalls).toContainEqual(
          expect.objectContaining({
            method: "benchLogsList",
            input: expect.objectContaining({
              projectVersionId: "v1",
              runId: "run-1",
            }),
          }),
        );
      },
      { timeout: 10_000 },
    );
  });

  it("renders a non-terminal ambiguous dispatch distinctly", async () => {
    const { RunDetail } = await import("./run-detail.js");
    const current = detail();
    const slot = renderSlot(
      {
        component: () => (
          <RunDetail projectId="p1" projectVersionId="v1" runId="run-1" />
        ),
      },
      {},
      {
        rpc: {
          benchRunGet: () => ({
            ...current,
            label: "tier1 running",
            fields: {
              ...current.fields,
              tier: "tier1",
              status: "running",
              failureCode: "FORGE_DISPATCH_AMBIGUOUS",
              failureReason: "socket hang up",
            },
          }),
          benchLogsList: () => ({ items: [], total: 0, next: null, cache }),
          benchOtaVerdictGet: verdict,
        },
      },
    );

    expect(
      await slot.findByText(/Forge dispatch outcome is ambiguous/u),
    ).toBeTruthy();
    expect(slot.getByText("socket hang up")).toBeTruthy();
    expect(
      slot.getByText(/Do not dispatch a duplicate while reconciliation/u),
    ).toBeTruthy();
  });

  it("keeps do-not-duplicate guidance prominent after reconciliation fails", async () => {
    const { RunDetail } = await import("./run-detail.js");
    const current = detail();
    const slot = renderSlot(
      {
        component: () => (
          <RunDetail projectId="p1" projectVersionId="v1" runId="run-1" />
        ),
      },
      {},
      {
        rpc: {
          benchRunGet: () => ({
            ...current,
            label: "tier1 failed",
            fields: {
              ...current.fields,
              tier: "tier1",
              status: "failed",
              failureCode: "FORGE_DISPATCH_RECONCILIATION_FAILED",
              failureReason: "Polling reached its liveness ceiling.",
            },
          }),
          benchLogsList: () => ({ items: [], total: 0, next: null, cache }),
          benchOtaVerdictGet: verdict,
        },
      },
    );

    expect(
      await slot.findByText(/Forge dispatch outcome is ambiguous/u),
    ).toBeTruthy();
    expect(slot.getByText(/Do not dispatch a duplicate;/u)).toBeTruthy();
  });

  it("renders unknown-run recovery and stale cache truthfully", async () => {
    const { RunDetail } = await import("./run-detail.js");
    const unknown = renderSlot(
      {
        component: () => (
          <RunDetail projectId="p1" projectVersionId="v1" runId="missing" />
        ),
      },
      {},
      {
        rpc: {
          benchRunGet: () => Promise.reject(new Error("BENCH_RUN_NOT_FOUND")),
        },
      },
    );
    expect(await unknown.findByText("Unknown bench run")).toBeTruthy();
    unknown.lifecycle.unmount();
    const stale = renderSlot(
      {
        component: () => (
          <RunDetail projectId="p1" projectVersionId="v1" runId="run-1" />
        ),
      },
      {},
      {
        rpc: {
          benchRunGet: () => detail("stale"),
          benchLogsList: () => ({ items: [], total: 0, next: null, cache }),
          benchOtaVerdictGet: verdict,
        },
      },
    );
    expect(await stale.findByText("cached")).toBeTruthy();
    expect(stale.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("carries the locally resolved project version from thread lookup into detail", async () => {
    const { BenchThreadRunDetail } = await import("./run-detail.js");
    const slot = renderSlot(
      { component: BenchThreadRunDetail },
      { threadId: "thread-1", params: null },
      {
        context: { projectId: "p1", threadId: "thread-1" },
        rpc: {
          benchRunsList: () => ({
            items: [
              {
                projectId: "p1",
                projectVersionId: "v1",
                kind: "verificationRun",
                key: "run-1",
                label: "tier0 completed",
                fields: { threadId: "thread-1" },
              },
            ],
            total: 1,
            next: null,
            cache,
          }),
          benchRunGet: (input: unknown) => {
            if (
              typeof input !== "object" ||
              input === null ||
              Reflect.get(input, "projectVersionId") !== "v1"
            ) {
              throw new Error("BENCH_RUN_NOT_FOUND");
            }
            return detail();
          },
          benchLogsList: () => ({ items: [], total: 0, next: null, cache }),
          benchOtaVerdictGet: verdict,
        },
      },
    );
    expect(await slot.findByText("run-1")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toContainEqual(
      expect.objectContaining({
        method: "benchRunGet",
        input: expect.objectContaining({
          projectVersionId: "v1",
          runId: "run-1",
        }),
      }),
    );
  });
});

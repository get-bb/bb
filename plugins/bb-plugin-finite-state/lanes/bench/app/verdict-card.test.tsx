// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { installTestPluginRuntime, renderSlot } from "@bb/plugin-sdk/testing/app";
import type { VerdictEvidence, VerdictResult } from "../verdict/evaluate.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

beforeAll(() => installTestPluginRuntime());
afterEach(() => cleanup());

function verdict(
  state: VerdictResult["verdict"],
  overrides: Partial<VerdictResult> = {},
): VerdictResult {
  const coverageState: VerdictEvidence["state"] = state === "SAFE_TO_OTA" ? "proven" : state === "NOT_SAFE" ? "failed" : "unsigned";
  const evidence = {
    requirementId: "REQ-A",
    tier: "static" as const,
    state: coverageState,
    required: true,
    runId: "run-a",
    checkId: "check-a",
    resultId: "result-a",
    outcome: state === "NOT_SAFE" ? "fail" : "pass",
    attestationVerified: state === "SAFE_TO_OTA",
    evidenceDigest: DIGEST_A,
    ...(state === "SAFE_TO_OTA" ? {
      attestationId: "attestation-a",
      signerIdentity: "builder@example.test",
    } : {}),
  };
  return {
    pvId: "v1",
    firmwareDigest: DIGEST_A,
    currentMountedDigest: DIGEST_A,
    verdict: state,
    stale: false,
    required: 1,
    proven: state === "SAFE_TO_OTA" ? 1 : 0,
    failed: state === "NOT_SAFE" ? 1 : 0,
    gaps: state === "INCONCLUSIVE" ? 1 : 0,
    evidence: [evidence],
    issues: [],
    computedAt: "2026-08-13T12:00:00.000Z",
    ...overrides,
  };
}

describe("VerdictCard", () => {
  it.each([
    ["SAFE_TO_OTA", "Safe to OTA", "text-success"],
    ["NOT_SAFE", "Not safe to OTA", "text-destructive"],
    ["INCONCLUSIVE", "Inconclusive", "text-warning"],
  ] as const)("renders %s with accessible text, icon, and color", async (state, label, color) => {
    const { VerdictCard } = await import("./verdict-card.js");
    const slot = renderSlot({ component: () => <VerdictCard id="v1" /> }, {}, {
      context: { projectId: "p1" },
      rpc: { benchOtaVerdictGet: () => verdict(state) },
    });
    const card = await slot.findByLabelText(`OTA verdict: ${label}`);
    expect(card.className).toContain(state === "SAFE_TO_OTA" ? "border-success" : state === "NOT_SAFE" ? "border-destructive" : "border-warning");
    expect(slot.getByText(label).className).toContain(color);
  });

  it("shows digest staleness, failure drill-through, and exact evidence links", async () => {
    const { VerdictCard } = await import("./verdict-card.js");
    const slot = renderSlot({ component: () => <VerdictCard digest={DIGEST_A} id="v1" /> }, {}, {
      context: { projectId: "p1" },
      rpc: { benchOtaVerdictGet: () => verdict("NOT_SAFE", { stale: true, currentMountedDigest: DIGEST_B }) },
    });
    expect(await slot.findByText("Historical — not current")).toBeTruthy();
    expect(slot.getByText(DIGEST_B)).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Matrix cell" }));
    fireEvent.click(slot.getByRole("button", { name: "Run evidence" }));
    expect(slot.inspection.navigateCalls).toContainEqual(expect.objectContaining({ method: "toPluginPanel", path: "product-security", options: expect.objectContaining({ subPath: "verifications/REQ-A/static" }) }));
    expect(slot.inspection.navigateCalls).toContainEqual(expect.objectContaining({ method: "toPluginPanel", path: "bench", options: expect.objectContaining({ subPath: "run-a" }) }));
  });

  it("renders verified signature identity and evidence download", async () => {
    const { VerdictCard } = await import("./verdict-card.js");
    const slot = renderSlot({ component: () => <VerdictCard id="v1" /> }, {}, {
      context: { projectId: "p1" },
      rpc: { benchOtaVerdictGet: () => verdict("SAFE_TO_OTA") },
    });
    expect(await slot.findByText(/builder@example\.test/u)).toBeTruthy();
    expect(slot.getByText("attestation-a")).toBeTruthy();
    expect(slot.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
      "/api/v1/plugins/finite-state/http/bench/runs/attestation?projectId=p1&runId=run-a",
    );
  });

  it("does not call an out-of-scope or invalid attestation a verified proof", async () => {
    const { VerdictCard } = await import("./verdict-card.js");
    for (const state of ["insufficient_scope", "invalid_signature"] as const) {
      const result = verdict("INCONCLUSIVE", {
        evidence: [{
          ...verdict("SAFE_TO_OTA").evidence[0]!,
          state,
          attestationVerified: true,
        }],
      });
      const slot = renderSlot({ component: () => <VerdictCard id="v1" /> }, {}, {
        context: { projectId: "p1" },
        rpc: { benchOtaVerdictGet: () => result },
      });
      expect(await slot.findAllByText(state === "insufficient_scope"
        ? "Insufficient attestation scope"
        : "Invalid signature")).toHaveLength(2);
      expect(slot.getByText("No counted proof has a verified, subject-bound signature.")).toBeTruthy();
      slot.lifecycle.unmount();
    }
  });

  it("qualifies a safe verdict when the mounted digest is unknown", async () => {
    const { VerdictCard } = await import("./verdict-card.js");
    const slot = renderSlot({ component: () => <VerdictCard digest={DIGEST_A} id="v1" /> }, {}, {
      context: { projectId: "p1" },
      rpc: { benchOtaVerdictGet: () => verdict("SAFE_TO_OTA", { currentMountedDigest: null }) },
    });
    expect(await slot.findByText("Mounted digest unknown")).toBeTruthy();
    expect(slot.getByText("unavailable")).toBeTruthy();
  });

  it("uses an embedded project scope when the surrounding panel has no project context", async () => {
    const { VerdictCard } = await import("./verdict-card.js");
    const slot = renderSlot(
      { component: () => <VerdictCard id="v1" projectId="p1" /> },
      {},
      { rpc: { benchOtaVerdictGet: () => verdict("SAFE_TO_OTA") } },
    );
    expect(await slot.findByText("Safe to OTA")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({
      method: "benchOtaVerdictGet",
      input: expect.objectContaining({ projectId: "p1", pvId: "v1" }),
    }));
  });

  it("designs loading, model-empty, error, unconfigured, and unknown-id states", async () => {
    const { VerdictCard } = await import("./verdict-card.js");
    const unresolved = new Promise<VerdictResult>(() => {});
    const loading = renderSlot({ component: () => <VerdictCard id="v1" /> }, {}, { context: { projectId: "p1" }, rpc: { benchOtaVerdictGet: () => unresolved } });
    expect(loading.getByLabelText("Loading OTA verdict")).toBeTruthy();
    loading.lifecycle.unmount();

    const empty = renderSlot({ component: () => <VerdictCard id="v1" /> }, {}, { context: { projectId: "p1" }, rpc: { benchOtaVerdictGet: () => verdict("INCONCLUSIVE", { required: 0, gaps: 0, evidence: [], issues: [{ code: "MODEL_UNAVAILABLE", message: "The accepted requirement model is missing or invalid." }] }) } });
    expect(await empty.findByText("MODEL_UNAVAILABLE")).toBeTruthy();
    empty.lifecycle.unmount();

    const failed = renderSlot({ component: () => <VerdictCard id="v1" /> }, {}, { context: { projectId: "p1" }, rpc: { benchOtaVerdictGet: () => Promise.reject(new Error("VERDICT_NOT_FOUND")) } });
    expect(await failed.findByText("VERDICT_NOT_FOUND")).toBeTruthy();
    expect(failed.getByRole("button", { name: "Retry" })).toBeTruthy();
    failed.lifecycle.unmount();

    const unconfigured = renderSlot({ component: () => <VerdictCard /> }, {}, { context: { projectId: "p1" } });
    expect(unconfigured.getByText(/Select a product version/u)).toBeTruthy();
    unconfigured.lifecycle.unmount();

    const rpc = vi.fn();
    const unknown = renderSlot({ component: () => <VerdictCard id="bad/id" /> }, {}, { context: { projectId: "p1" }, rpc: { benchOtaVerdictGet: rpc } });
    expect(unknown.getByText(/identifier is invalid/u)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
});

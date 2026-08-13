// @vitest-environment jsdom

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { rpcContract } from "../../../../shared/contract.js";
import { connectedRemoteStatus } from "../../../../test/app-connections.js";
import { aggregateCell, aggregateCellForTier, type VerificationResult } from "./aggregate.js";
import { registerVerificationMatrixBackend } from "./backend.js";
import type { MatrixFilterValue } from "./MatrixFilters.js";
import type { MatrixRow, VerificationTier } from "./status.js";
import {
  mapBenchTierToVerificationTier,
  mapCheckToTier,
  TierMappingError,
  type CheckModel,
} from "./tier-map.js";
import { VerificationMatrixView } from "./VerificationMatrix.js";

const PROJECT_ID = "project-matrix";
const VERSION_ID = "version-matrix";
const GENERATION_ID = "generation-matrix";
const NOW = "2026-08-13T12:00:00.000Z";

class MatrixResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() => this.callback([{
      target,
      contentRect: new DOMRectReadOnly(0, 0, 1200, 650),
      borderBoxSize: [{ blockSize: 650, inlineSize: 1200 }],
      contentBoxSize: [{ blockSize: 650, inlineSize: 1200 }],
      devicePixelContentBoxSize: [{ blockSize: 650, inlineSize: 1200 }],
    }], this));
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", MatrixResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 650,
  });
  HTMLElement.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0;
    this.dispatchEvent(new Event("scroll"));
  };
});

afterEach(() => cleanup());

function check(
  checkId: string,
  checkType: string,
  options: Partial<Pick<CheckModel, "category" | "parameters" | "required">> = {},
): CheckModel {
  return {
    checkId,
    checkType,
    category: options.category ?? null,
    parameters: options.parameters ?? null,
    required: options.required ?? true,
  };
}

function result(
  resultId: string,
  status: VerificationResult["status"],
  options: Partial<VerificationResult> = {},
): VerificationResult {
  return {
    resultId,
    requirementId: "REQ-1",
    checkId: "check-1",
    tier: "static",
    status,
    runId: `run-${resultId}`,
    executedAt: NOW,
    isLatest: true,
    mappingState: "mapped",
    firmwareVersionId: VERSION_ID,
    ...options,
  };
}

function emptyCells(requirementId: string): MatrixRow["cells"] {
  return {
    static: aggregateCellForTier(requirementId, "static", [], []),
    emulation: aggregateCellForTier(requirementId, "emulation", [], []),
    hil: aggregateCellForTier(requirementId, "hil", [], []),
    manual: aggregateCellForTier(requirementId, "manual", [], []),
    hardware: aggregateCellForTier(requirementId, "hardware", [], []),
  };
}

function matrixRow(index: number): MatrixRow {
  const requirementId = `REQ-${String(index).padStart(4, "0")}`;
  const cells = emptyCells(requirementId);
  cells.static = aggregateCellForTier(
    requirementId,
    "static",
    [check(`check-${index}`, "config_check")],
    [result(`result-${index}`, index === 0 ? "failed" : "verified", { requirementId })],
  );
  return {
    requirementId,
    title: `The device shall enforce control ${index}`,
    pattern: "ubiquitous",
    requirementType: "security",
    priority: "high",
    stale: index === 0,
    unknownCheckCount: 0,
    suppressedCheckCount: 0,
    cells,
  };
}

describe("verification tier mapping and aggregation", () => {
  it.each([
    ["config_check", "static"],
    ["sbom_query", "static"],
    ["binary_analysis", "static"],
    ["binary_pattern", "static"],
    ["vuln_absence", "static"],
    ["external_sync", "hil"],
    ["manual", "manual"],
    ["attestation", "manual"],
    ["document_review", "manual"],
  ] as const)("maps %s to %s", (checkType, expected) => {
    expect(mapCheckToTier(check("check", checkType))).toBe(expected);
  });

  it("uses the documented dynamic vocabulary and fails visibly when it is absent or contradictory", () => {
    expect(mapCheckToTier(check("emu", "dynamic", { category: "renode" }))).toBe("emulation");
    expect(mapCheckToTier(check("hil", "dynamic", { parameters: JSON.stringify({ bench_tier: "tier3" }) }))).toBe("hil");
    expect(() => mapCheckToTier(check("unknown", "dynamic"))).toThrowError(TierMappingError);
    expect(() => mapCheckToTier(check("conflict", "dynamic", {
      category: "qemu",
      parameters: JSON.stringify({ tier: "hil" }),
    }))).toThrow(/TIER_UNKNOWN.*disagree/u);
  });

  it.each([
    ["tier0", "static"], ["tier1", "emulation"], ["tier2", "emulation"],
    ["tier3", "hil"], ["tier4", "manual"],
  ] as const)("maps bench %s to %s", (tier, expected) => {
    expect(mapBenchTierToVerificationTier(tier)).toBe(expected);
  });

  it("uses all latest evidence rows and applies the worst-wins ladder", () => {
    const cell = aggregateCellForTier(
      "REQ-1",
      "static",
      [check("check-1", "config_check"), check("check-2", "config_check", { required: false })],
      [
        result("old-failure", "failed", { isLatest: false }),
        result("verified", "verified"),
        result("inconclusive", "inconclusive", { checkId: "check-2" }),
        result("unmapped", "failed", { mappingState: "unmapped" }),
      ],
    );
    expect(cell.state).toBe("failed");
    expect(cell.checkCount).toBe(2);
    expect(cell.requiredCount).toBe(1);
    expect(cell.runIds).toEqual(["run-inconclusive", "run-unmapped", "run-verified"]);
  });

  it("distinguishes mapped-not-run from no mapping", () => {
    expect(aggregateCellForTier("REQ-1", "static", [check("check", "config_check")], []).state).toBe("mapped_not_run");
    expect(aggregateCellForTier("REQ-1", "static", [], []).state).toBe("unmapped");
    expect(aggregateCell([check("check", "config_check")], []).state).toBe("mapped_not_run");
  });
});

function insertFixtureRows(): ReturnType<typeof createFakePluginHost> {
  const host = createFakePluginHost({ pluginId: "finite-state" });
  const ctx = createPluginContext(host.bb);
  registerVerificationMatrixBackend(host.bb, ctx);
  const db = ctx.db();
  db.prepare(`INSERT INTO pull_generation (
    project_id, project_version_id, generation_id, status, requested_kinds_json,
    started_at, completed_at, accepted_at, error
  ) VALUES (?, ?, ?, 'accepted', '[]', ?, ?, ?, NULL)`).run(
    PROJECT_ID, VERSION_ID, GENERATION_ID, NOW, NOW, NOW,
  );
  db.prepare(`INSERT INTO sync_state (
    project_id, project_version_id, entity_kind, accepted_generation_id,
    staging_generation_id, base_revision, staging_continuation, staged_pages,
    staged_rows, last_pull, error
  ) VALUES (?, ?, 'requirement', ?, NULL, 1, NULL, 1, 3, ?, NULL)`).run(
    PROJECT_ID, VERSION_ID, GENERATION_ID, NOW,
  );
  const snapshot = db.prepare(`INSERT INTO base_snapshot (
    project_id, project_version_id, entity_kind, generation_id, entity_key,
    remote_id, payload, content_hash, pulled_at
  ) VALUES (?, ?, 'requirement', ?, ?, ?, ?, ?, ?)`);
  for (const [id, pulledAt] of [
    ["REQ-FAILED", "2026-08-13T11:00:00.000Z"],
    ["REQ-VERIFIED", "2026-08-13T11:00:00.000Z"],
    ["REQ-UNKNOWN", "2026-08-13T12:30:00.000Z"],
  ] as const) {
    snapshot.run(
      PROJECT_ID, VERSION_ID, GENERATION_ID, `key-${id}`, id,
      JSON.stringify({ id, ears: { text: `${id} shall be proven`, pattern: "ubiquitous" }, req_type: "security", priority: "high" }),
      `hash-${id}`, pulledAt,
    );
  }
  const insertCheck = db.prepare(`INSERT INTO verification_checks (
    project_id, project_version_id, generation_id, check_id, code, name,
    check_type, category, description, pass_criteria, fail_criteria,
    input_description, parameters, default_sla_days, deleted_at, review_status,
    review_version, raw, pulled_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL, NULL, '0', '{}', ?)`);
  insertCheck.run(PROJECT_ID, VERSION_ID, GENERATION_ID, "check-static", "CHK-static", "Static check", "config_check", null, null, NOW);
  insertCheck.run(PROJECT_ID, VERSION_ID, GENERATION_ID, "check-dynamic", "CHK-dynamic", "Unknown dynamic", "dynamic", null, null, NOW);
  const mapping = db.prepare(`INSERT INTO requirement_check_mappings (
    project_id, project_version_id, generation_id, requirement_key, check_id,
    is_required, coverage_level, suppressed, raw, pulled_at
  ) VALUES (?, ?, ?, ?, ?, 1, NULL, 0, '{}', ?)`);
  mapping.run(PROJECT_ID, VERSION_ID, GENERATION_ID, "key-REQ-FAILED", "check-static", NOW);
  mapping.run(PROJECT_ID, VERSION_ID, GENERATION_ID, "key-REQ-VERIFIED", "check-static", NOW);
  mapping.run(PROJECT_ID, VERSION_ID, GENERATION_ID, "key-REQ-UNKNOWN", "check-dynamic", NOW);
  const insertResult = db.prepare(`INSERT INTO verification_results (
    project_id, project_version_id, generation_id, result_id, run_id,
    requirement_key, check_id, tier, status, outcome, confidence,
    evidence_summary, result_data, measured, executed_at, executed_by,
    failure_reason, remediation_suggestion, fs_version_id, fs_version_name,
    is_latest, superseded_by, sla_status, mapping_state, raw, pulled_at
  ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'static', ?, NULL, NULL, NULL, NULL, NULL,
    ?, NULL, NULL, NULL, ?, NULL, ?, ?, NULL, 'mapped', '{}', ?)`);
  insertResult.run(PROJECT_ID, VERSION_ID, GENERATION_ID, "result-failed-old", "key-REQ-FAILED", "check-static", "verified", "2026-08-13T10:00:00.000Z", VERSION_ID, 0, "result-failed", NOW);
  insertResult.run(PROJECT_ID, VERSION_ID, GENERATION_ID, "result-failed", "key-REQ-FAILED", "check-static", "failed", NOW, VERSION_ID, 1, null, NOW);
  insertResult.run(PROJECT_ID, VERSION_ID, GENERATION_ID, "result-verified", "key-REQ-VERIFIED", "check-static", "verified", NOW, VERSION_ID, 1, null, NOW);
  return host;
}

describe("verification matrix production RPC", () => {
  it("registers the frozen RPC and serves keyset pages from the generation index", async () => {
    const host = insertFixtureRows();
    expect(host.harness.inspection.registrations.rpcMethods).toContain("verificationsMatrix");
    const first = rpcContract.verificationsMatrix.output.parse(await host.harness.behavior.callRpc("verificationsMatrix", {
      projectId: PROJECT_ID,
      projectVersionId: VERSION_ID,
      pageSize: 2,
      continuation: null,
      filters: {},
    }));
    expect(first.total).toBe(3);
    expect(first.items.map((item) => item.key)).toEqual(["REQ-FAILED", "REQ-UNKNOWN"]);
    expect(first.next).not.toBeNull();
    const unknownFields = first.items[1]?.fields;
    const unknownRow = unknownFields?.row;
    expect(
      typeof unknownRow === "object" && unknownRow !== null && !Array.isArray(unknownRow)
        ? Reflect.get(unknownRow, "unknownCheckCount")
        : null,
    ).toBe(1);
    const second = rpcContract.verificationsMatrix.output.parse(await host.harness.behavior.callRpc("verificationsMatrix", {
      projectId: PROJECT_ID,
      projectVersionId: VERSION_ID,
      pageSize: 2,
      continuation: first.next,
      filters: {},
    }));
    expect(second.items.map((item) => item.key)).toEqual(["REQ-VERIFIED"]);
    expect(second.next).toBeNull();
    expect(second.total).toBe(3);
    expect(second.items[0]?.fields).toMatchObject({
      rollup: { requirements: 3, failed: 1, verified: 1 },
    });

    const db = createPluginContext(host.bb).db();
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT requirement_id
      FROM fs_verification_matrix_index
      WHERE project_id = ? AND project_version_id = ?
        AND (unproven_rank > ? OR (unproven_rank = ? AND requirement_id > ?))
      ORDER BY unproven_rank, requirement_id LIMIT 200`).all(
      PROJECT_ID, VERSION_ID, 0, 0, "REQ-FAILED",
    );
    expect(JSON.stringify(plan)).toContain("fs_verification_matrix_page");
    await host.harness.lifecycle.dispose();
  });

  it("defaults unproven filtering without treating unknown dynamic checks as coverage", async () => {
    const host = insertFixtureRows();
    const page = rpcContract.verificationsMatrix.output.parse(await host.harness.behavior.callRpc("verificationsMatrix", {
      projectId: PROJECT_ID,
      projectVersionId: VERSION_ID,
      pageSize: 200,
      continuation: null,
      filters: { unprovenOnly: true },
    }));
    expect(page.items.map((item) => item.key)).toEqual(["REQ-FAILED", "REQ-UNKNOWN"]);
    const literalWildcard = rpcContract.verificationsMatrix.output.parse(await host.harness.behavior.callRpc("verificationsMatrix", {
      projectId: PROJECT_ID,
      projectVersionId: VERSION_ID,
      pageSize: 200,
      continuation: null,
      filters: { text: "%" },
    }));
    expect(literalWildcard.items).toEqual([]);
    await host.harness.lifecycle.dispose();
  });

  it("invalidates cached ranks when latest evidence changes without a requirement revision", async () => {
    const host = insertFixtureRows();
    const input = {
      projectId: PROJECT_ID,
      projectVersionId: VERSION_ID,
      pageSize: 20,
      continuation: null,
      filters: { status: "failed" },
    };
    const first = rpcContract.verificationsMatrix.output.parse(
      await host.harness.behavior.callRpc("verificationsMatrix", input),
    );
    expect(first.items.map((item) => item.key)).toEqual(["REQ-FAILED"]);
    createPluginContext(host.bb).db().prepare(`UPDATE verification_results
      SET status = 'failed', pulled_at = '2026-08-13T13:00:00.000Z'
      WHERE result_id = 'result-verified'`).run();
    const refreshed = rpcContract.verificationsMatrix.output.parse(
      await host.harness.behavior.callRpc("verificationsMatrix", input),
    );
    expect(refreshed.items.map((item) => item.key)).toEqual(["REQ-FAILED", "REQ-VERIFIED"]);
    await host.harness.lifecycle.dispose();
  });

  it("keeps failed latest evidence visible without a live mapping and identifies suppressed mappings", async () => {
    const host = insertFixtureRows();
    const db = createPluginContext(host.bb).db();
    const snapshot = db.prepare(`INSERT INTO base_snapshot (
      project_id, project_version_id, entity_kind, generation_id, entity_key,
      remote_id, payload, content_hash, pulled_at
    ) VALUES (?, ?, 'requirement', ?, ?, ?, ?, ?, ?)`);
    for (const id of ["REQ-NOMAP", "REQ-SUPPRESSED"] as const) {
      snapshot.run(
        PROJECT_ID, VERSION_ID, GENERATION_ID, `key-${id}`, id,
        JSON.stringify({ id, ears: { text: `${id} shall expose failed evidence`, pattern: "ubiquitous" } }),
        `hash-${id}`, NOW,
      );
    }
    db.prepare(`INSERT INTO requirement_check_mappings (
      project_id, project_version_id, generation_id, requirement_key, check_id,
      is_required, coverage_level, suppressed, raw, pulled_at
    ) VALUES (?, ?, ?, 'key-REQ-SUPPRESSED', 'check-static', 1, NULL, 1, '{}', ?)`)
      .run(PROJECT_ID, VERSION_ID, GENERATION_ID, NOW);
    const insertResult = db.prepare(`INSERT INTO verification_results (
      project_id, project_version_id, generation_id, result_id, run_id,
      requirement_key, check_id, tier, status, outcome, confidence,
      evidence_summary, result_data, measured, executed_at, executed_by,
      failure_reason, remediation_suggestion, fs_version_id, fs_version_name,
      is_latest, superseded_by, sla_status, mapping_state, raw, pulled_at
    ) VALUES (?, ?, ?, ?, NULL, ?, 'check-static', 'static', 'failed', NULL, NULL,
      NULL, NULL, NULL, ?, NULL, NULL, NULL, ?, NULL, 1, NULL, NULL, 'mapped', '{}', ?)`);
    insertResult.run(PROJECT_ID, VERSION_ID, GENERATION_ID, "result-nomap", "key-REQ-NOMAP", NOW, VERSION_ID, NOW);
    insertResult.run(PROJECT_ID, VERSION_ID, GENERATION_ID, "result-suppressed", "key-REQ-SUPPRESSED", NOW, VERSION_ID, NOW);

    const page = rpcContract.verificationsMatrix.output.parse(await host.harness.behavior.callRpc("verificationsMatrix", {
      projectId: PROJECT_ID,
      projectVersionId: VERSION_ID,
      pageSize: 20,
      continuation: null,
      filters: { status: "failed" },
    }));
    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.key)).toEqual(["REQ-FAILED", "REQ-NOMAP", "REQ-SUPPRESSED"]);
    for (const item of page.items) {
      expect(item.fields).toMatchObject({ row: { cells: { static: { state: "failed" } } } });
    }
    expect(page.items.find((item) => item.key === "REQ-NOMAP")?.fields)
      .toMatchObject({ row: { suppressedCheckCount: 0 } });
    expect(page.items.find((item) => item.key === "REQ-SUPPRESSED")?.fields)
      .toMatchObject({ row: { suppressedCheckCount: 1 } });
    await host.harness.lifecycle.dispose();
  });

  it("reads the manual preference independently of zero-row matrix pages", async () => {
    const host = insertFixtureRows();
    const input = {
      projectId: PROJECT_ID,
      projectVersionId: VERSION_ID,
      pageSize: 20,
      continuation: null,
      filters: { unprovenOnly: false },
    };
    await expect(host.harness.behavior.callRpc("verificationMatrixPreferenceGet", {
      projectId: PROJECT_ID,
    })).resolves.toEqual({ showManual: false });

    await expect(host.harness.behavior.callRpc("verificationMatrixPreferenceSet", {
      projectId: PROJECT_ID,
      showManual: true,
    })).resolves.toEqual({ showManual: true });

    const empty = rpcContract.verificationsMatrix.output.parse(
      await host.harness.behavior.callRpc("verificationsMatrix", {
        ...input,
        filters: { text: "does-not-exist" },
      }),
    );
    expect(empty.items).toEqual([]);
    await expect(host.harness.behavior.callRpc("verificationMatrixPreferenceGet", {
      projectId: PROJECT_ID,
    })).resolves.toEqual({ showManual: true });
    await host.harness.lifecycle.dispose();
  });
});

function MatrixHarness({ rows, open }: { rows: MatrixRow[]; open(requirementId: string, tier: VerificationTier): void }): React.JSX.Element {
  const [filters, setFilters] = useState<MatrixFilterValue>({
    text: "", tier: "all", status: "all", unprovenOnly: true, showManual: false,
  });
  return <VerificationMatrixView filters={filters} hasNextPage={false} message={null} onFiltersChange={setFilters} onLoadMore={() => {}} onOpenCell={open} onRefresh={() => {}} rollup={null} rows={rows} state="ready" total={rows.length} />;
}

describe("verification matrix UI", () => {
  it("bounds 5,000 rows, hides manual by default, toggles it, navigates cells, and supports arrow focus", async () => {
    const open = vi.fn();
    const view = render(<MatrixHarness open={open} rows={Array.from({ length: 5_000 }, (_, index) => matrixRow(index))} />);
    await view.findByText("REQ-0000");
    expect(view.container.querySelectorAll("[data-matrix-row]").length).toBeLessThan(40);
    expect(view.getByRole("grid").getAttribute("aria-rowcount")).toBe("5001");
    expect(view.queryByRole("columnheader", { name: "Manual" })).toBeNull();
    fireEvent.click(view.getByRole("checkbox", { name: "Manual evidence" }));
    expect(view.getByRole("columnheader", { name: "Manual" })).toBeTruthy();
    const staticCell = view.getByRole("gridcell", { name: /REQ-0000, static: Failed/u });
    fireEvent.click(staticCell);
    expect(open).toHaveBeenCalledWith("REQ-0000", "static");
    fireEvent.keyDown(staticCell, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toMatch(/REQ-0000, emulation/u));
  });

  it("renders loading, empty, error-with-data, stale, and unconfigured states", async () => {
    const props = {
      filters: { text: "", tier: "all", status: "all", unprovenOnly: true, showManual: false } satisfies MatrixFilterValue,
      hasNextPage: false,
      onFiltersChange: () => {}, onLoadMore: () => {}, onOpenCell: () => {}, onRefresh: () => {},
      rollup: null, total: 0,
    };
    const view = render(<VerificationMatrixView {...props} message={null} rows={[]} state="loading" />);
    expect(view.getByLabelText("Loading verification matrix")).toBeTruthy();
    view.rerender(<VerificationMatrixView {...props} message={null} rows={[]} state="ready" />);
    expect(view.getByText("No verification rows")).toBeTruthy();
    expect(view.getByLabelText("Verification matrix filters")).toBeTruthy();
    view.rerender(<VerificationMatrixView {...props} filters={{ ...props.filters, tier: "manual" }} message={null} rows={[matrixRow(0)]} state="ready" total={1} />);
    expect(view.getByRole("columnheader", { name: "Manual" })).toBeTruthy();
    expect(view.getByText("Manual evidence is shown because the Manual tier filter is active.")).toBeTruthy();
    view.rerender(<VerificationMatrixView {...props} message="Refresh fault" rows={[matrixRow(0)]} state="error" total={1} />);
    expect(view.getByText(/Refresh fault/u)).toBeTruthy();
    expect(await view.findByText("Stale")).toBeTruthy();
    view.rerender(<VerificationMatrixView {...props} message="Refresh fault" rows={[]} state="error" />);
    expect(view.getByLabelText("Verification matrix filters")).toBeTruthy();
    view.rerender(<VerificationMatrixView {...props} message={null} rows={[]} state="unconfigured" />);
    expect(view.getByText("Choose a project")).toBeTruthy();
  });

  it("refreshes the full loaded range after paging instead of collapsing to page one", async () => {
    const allRows = Array.from({ length: 201 }, (_, index) => matrixRow(index));
    allRows[0]!.cells.static = aggregateCellForTier(
      allRows[0]!.requirementId,
      "static",
      [check("running-check", "config_check")],
      [result("running-result", "running", { requirementId: allRows[0]!.requirementId })],
    );
    const requests: Array<{ continuation: string | null; pageSize: number }> = [];
    const matrixPage = (rawInput: unknown) => {
      const input = rpcContract.verificationsMatrix.input.parse(rawInput);
      requests.push(input);
      const selected = input.continuation
        ? allRows.slice(200)
        : allRows.slice(0, input.pageSize);
      return {
        items: selected.map((row) => ({
          projectId: PROJECT_ID,
          projectVersionId: VERSION_ID,
          kind: "verification-matrix-row",
          key: row.requirementId,
          label: row.title,
          fields: {
            row,
            rollup: {
              requirements: allRows.length,
              verified: 200,
              failed: 0,
              error: 0,
              inconclusive: 0,
              running: 1,
              pending: 0,
              skipped: 0,
            },
          },
        })),
        total: allRows.length,
        next: selected.length < allRows.length && input.continuation === null ? "next-page" : null,
        cache: {
          state: "fresh",
          asOf: NOW,
          message: null,
          acceptedGenerationId: GENERATION_ID,
          baseRevision: 1,
        },
      };
    };
    const app = await loadPluginApp(() => import("../../../../app.js"));
    const panel = app.navPanels.find((candidate) => candidate.id === "product-security");
    if (!panel) throw new Error("Product Security panel was not registered");
    const slot = renderSlot(panel, { subPath: "verifications" }, {
      context: { projectId: PROJECT_ID, threadId: null },
      rpc: {
        connectionsStatus: connectedRemoteStatus,
        verificationMatrixPreferenceGet: () => ({ showManual: false }),
        verificationMatrixPreferenceSet: (input) => input,
        verificationsMatrix: matrixPage,
      },
    });
    expect(await slot.findByRole("button", { name: "Load more unproven requirements" })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Load more unproven requirements" }));
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ continuation: "next-page" }));
    await waitFor(() => expect(slot.queryByRole("button", { name: "Load more unproven requirements" })).toBeNull());

    await slot.behavior.emitRealtime("verifications:changed", { projectId: PROJECT_ID });
    await waitFor(() => expect(requests.slice(-2)).toEqual([
      expect.objectContaining({ continuation: null, pageSize: 200 }),
      expect.objectContaining({ continuation: "next-page", pageSize: 1 }),
    ]));
    expect(slot.getByRole("grid").getAttribute("aria-rowcount")).toBe("202");
    slot.lifecycle.unmount();
  });
});

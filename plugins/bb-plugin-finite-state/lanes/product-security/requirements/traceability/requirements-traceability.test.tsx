// @vitest-environment jsdom

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { installTestPluginRuntime, renderSlot } from "@bb/plugin-sdk/testing/app";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { reqIdKey } from "../../../../lib/sync/registry.js";
import { rpcContract } from "../../../../shared/contract.js";
import { registerRequirementsCardsBackend } from "../cards/backend.js";
import {
  requirementSemanticSha256,
  serializeRequirement,
} from "../cards/adapter.js";
import type { RequirementCardModel, RequirementYamlV1 } from "../cards/schema.js";
import { registerRequirementsTraceabilityBackend } from "./backend.js";
import {
  parseRequirementFilters,
  parseTraceabilityDetail,
  serializeRequirementFilters,
  traceabilitySubPath,
  type RequirementFilters,
} from "./filters.js";
import { getRequirementGitHistory, type GitHistoryRunner } from "./git-history.js";
import type { RequirementFacets, TraceabilityListFields } from "./query.js";
import type { RequirementTraceModel } from "./resolvers.js";

const observed = new WeakSet<Element>();
class TraceResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    if (observed.has(target)) return;
    observed.add(target);
    queueMicrotask(() => this.callback([{
      target,
      contentRect: new DOMRectReadOnly(0, 0, 960, 720),
      borderBoxSize: [{ blockSize: 720, inlineSize: 960 }],
      contentBoxSize: [{ blockSize: 720, inlineSize: 960 }],
      devicePixelContentBoxSize: [{ blockSize: 720, inlineSize: 960 }],
    }], this));
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  installTestPluginRuntime();
  vi.stubGlobal("ResizeObserver", TraceResizeObserver);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 960, 720));
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(720);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(960);
});

afterEach(() => cleanup());
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function requirement(id: string, overrides: Partial<RequirementYamlV1> = {}): RequirementYamlV1 {
  return {
    schema: "fs-requirement/v1",
    id,
    req_type: "security",
    priority: "P1",
    status: "approved",
    ears: {
      pattern: "event_driven",
      text: "WHEN an update arrives, the gateway SHALL verify its signature",
      parts: { trigger: "an update arrives", system: "gateway", response: "verify its signature" },
    },
    rationale: "Prevents unsigned firmware execution.",
    source_description: "Firmware updates must be cryptographically verified.",
    mitigations: ["MIT-signed-update"],
    controls: ["CTRL-secure-update"],
    standards: ["EU-CRA/annex1-2c"],
    verification: [{
      check: "CHK-signature",
      method: "binary_analysis",
      tier: "static",
      required: true,
      pass_criteria: "Signature validation dominates the flash write.",
      expected_evidence: ["call graph"],
    }],
    ...overrides,
  };
}

function card(id = "REQ-104"): RequirementCardModel {
  return {
    requirement: requirement(id),
    evidenceState: "verified",
    stale: false,
    local: false,
    tiers: [
      { tier: "static", state: "verified", count: 1 },
      { tier: "emulation", state: "not_run", count: 0 },
      { tier: "hil", state: "not_run", count: 0 },
      { tier: "manual", state: "not_run", count: 0 },
    ],
    sourceSha256: "a".repeat(64),
  };
}

const facets: RequirementFacets = {
  pattern: [{ value: "event_driven", count: 1 }],
  reqType: [{ value: "security", count: 1 }],
  priority: [{ value: "P1", count: 1 }],
  evidenceState: [{ value: "verified", count: 1 }],
  tier: [{ value: "static", count: 1 }],
  stale: 0,
  localOnly: 0,
};

function traceModel(id = "REQ-104"): RequirementTraceModel {
  const model = card(id);
  return {
    card: model,
    evidence: [{ resultId: "result-1", checkId: "check-1", runId: "run-1", tier: "static", status: "verified", summary: "Signature path verified.", executedAt: "2026-08-12T12:00:00Z" }],
    rail: {
      requirementId: id,
      nodes: [
        { kind: "threat", id: "THREAT-22", label: "Unsigned update", ready: true, relation: "shares mitigation", navigation: { subPath: "tara/nodes/COMP-updater", label: "Focus COMP-updater in canvas" } },
        { kind: "requirement", id, label: "Verify signature", ready: true, relation: "selected requirement" },
        { kind: "clause", id: "clause-1", label: "CRA §2(c)", ready: true, relation: "mapped clause; not proof", provenance: { source: "review_version 4" } },
        { kind: "commit", id: "a".repeat(40), label: "a91f2 · require signed updates", ready: true, relation: "latest file commit" },
        { kind: "check", id: "check-1", label: "CHK-signature", ready: true, relation: "required static contract", navigation: { subPath: `verifications/${id}/static`, label: "Open matrix cell" } },
        { kind: "run", id: "run-1", label: "static · completed", ready: true, relation: "produced evidence" },
        { kind: "attestation", id: "att-1", label: "att-1", ready: true, relation: "signature and subject verified" },
      ],
      gaps: [],
    },
  };
}

function rpcPage(fields: TraceabilityListFields, total = 1) {
  return {
    items: [{ projectId: "project-1", projectVersionId: "version-1", kind: "requirement-trace", key: fields.card.requirement.id, label: fields.card.requirement.id, fields: JSON.parse(JSON.stringify(fields)) }],
    total,
    next: null,
    cache: { state: "fresh", asOf: "2026-08-12T12:00:00Z", message: null, acceptedGenerationId: "g-1", baseRevision: 1 },
  };
}

describe("requirements traceability filters", () => {
  it("round-trips every filter through canonical requirements/trace subPath state", () => {
    const filters: RequirementFilters = {
      text: "signed update", pattern: ["event_driven", "state_driven"],
      reqType: ["security"], priority: ["P0", "P1"], evidenceState: ["failed", "partial"],
      stale: true, tier: "hil", standardClause: "EU-CRA/annex1-2c", threat: "THREAT-22",
      localOnly: true, cursor: "trace:v1:REQ-099", limit: 75,
    };
    const query = serializeRequirementFilters(filters);
    expect(parseRequirementFilters(query)).toEqual(filters);
    const subPath = traceabilitySubPath(filters, "REQ-104");
    const detail = subPath.split("/").slice(1).map((segment) => decodeURIComponent(segment));
    expect(parseTraceabilityDetail(detail)).toEqual({
      view: "requirement", requirementId: "REQ-104",
      filters: { ...filters, cursor: undefined }, malformedId: null,
    });
  });
});

describe("requirements traceability backend", () => {
  it("returns indexed filters/facets/cursors and a complete independently resolved rail", async () => {
    const root = mkdtempSync(join(tmpdir(), "fs51-trace-"));
    const directory = join(root, "product-security", "requirements");
    mkdirSync(directory, { recursive: true });
    const source = serializeRequirement(requirement("REQ-104"));
    const sourceTwo = serializeRequirement(requirement("REQ-200", {
      priority: "P2",
      ears: {
        pattern: "ubiquitous",
        text: "The gateway SHALL retain an update audit record",
        parts: { system: "gateway", response: "retain an update audit record" },
      },
    }));
    const artifact = join(directory, "REQ-104.yaml");
    writeFileSync(artifact, source);
    writeFileSync(join(directory, "REQ-200.yaml"), sourceTwo);
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "trace@example.test"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Trace Test"], { cwd: root });
    execFileSync("git", ["add", "product-security/requirements/REQ-104.yaml", "product-security/requirements/REQ-200.yaml"], { cwd: root });
    execFileSync("git", ["commit", "-m", "require signed updates"], { cwd: root });
    const host = createFakePluginHost({
      pluginId: "finite-state",
      sdk: {
        projects: { get: () => ({ sources: [{ hostId: "host-1", path: root, isDefault: true }] }) },
        files: {
          list: () => ({ files: [
            { name: "REQ-104.yaml", path: "REQ-104.yaml" },
            { name: "REQ-200.yaml", path: "REQ-200.yaml" },
          ], truncated: false }),
          read: ({ path }: { path: string }) => {
            const content = path.endsWith("REQ-200.yaml") ? sourceTwo : source;
            return { content, contentEncoding: "utf8" as const, sha256: createHash("sha256").update(content).digest("hex") };
          },
        },
      },
    });
    const context = createPluginContext(host.bb);
    const db = context.db();
    db.prepare(`INSERT INTO pull_generation
      (project_id, project_version_id, generation_id, status, requested_kinds_json, started_at, completed_at, accepted_at)
      VALUES ('project-1', 'version-1', 'g-1', 'accepted', '[]', ?, ?, ?)`).run("2026-08-12T12:00:00Z", "2026-08-12T12:00:00Z", "2026-08-12T12:00:00Z");
    for (const kind of ["requirement", "threat"]) {
      db.prepare(`INSERT INTO sync_state
        (project_id, project_version_id, entity_kind, accepted_generation_id, base_revision, last_pull)
        VALUES ('project-1', 'version-1', ?, 'g-1', 1, ?)`).run(kind, "2026-08-12T12:00:00Z");
    }
    db.prepare(`INSERT INTO base_snapshot
      (project_id, project_version_id, entity_kind, generation_id, entity_key, payload, content_hash, pulled_at)
      VALUES ('project-1', 'version-1', 'requirement', 'g-1', ?, ?, ?, ?)`).run(reqIdKey({ reqId: "REQ-104" }), JSON.stringify(requirement("REQ-104")), requirementSemanticSha256(requirement("REQ-104")), "2026-08-12T12:00:00Z");
    db.prepare(`INSERT INTO base_snapshot
      (project_id, project_version_id, entity_kind, generation_id, entity_key, payload, content_hash, pulled_at)
      VALUES ('project-1', 'version-1', 'threat', 'g-1', 'threat', ?, 'hash', ?)`).run(JSON.stringify({ fields: { slug: "THREAT-22", name: "Unsigned update", mitigations: ["MIT-signed-update"], affected_components: ["COMP-updater"] } }), "2026-08-12T12:00:00Z");
    db.prepare(`INSERT INTO standards
      (project_id, project_version_id, generation_id, standard_id, code, name, scope, review_version, raw, pulled_at)
      VALUES ('project-1', 'version-1', 'g-1', 'EU-CRA', 'CRA', 'Cyber Resilience Act', 'project', '3', '{}', ?)`).run("2026-08-12T12:00:00Z");
    db.prepare(`INSERT INTO standards_clauses
      (project_id, project_version_id, generation_id, standard_id, clause_id, clause_code, title, review_version, raw, pulled_at)
      VALUES ('project-1', 'version-1', 'g-1', 'EU-CRA', 'EU-CRA/annex1-2c', 'Annex I §2(c)', 'Secure update', '4', '{}', ?)`).run("2026-08-12T12:00:00Z");
    db.prepare(`INSERT INTO verification_checks
      (project_id, project_version_id, generation_id, check_id, code, name, check_type, review_version, raw, pulled_at)
      VALUES ('project-1', 'version-1', 'g-1', 'check-1', 'CHK-signature', 'Signature dominance', 'binary_analysis', '7', '{}', ?)`).run("2026-08-12T12:00:00Z");
    db.prepare(`INSERT INTO requirement_check_mappings
      (project_id, project_version_id, generation_id, requirement_key, check_id, is_required, raw, pulled_at)
      VALUES ('project-1', 'version-1', 'g-1', ?, 'check-1', 1, '{}', ?)`).run(reqIdKey({ reqId: "REQ-104" }), "2026-08-12T12:00:00Z");
    db.prepare(`INSERT INTO requirement_rollup
      (project_id, project_version_id, generation_id, requirement_key, total_checks, verified_checks, pulled_at)
      VALUES ('project-1', 'version-1', 'g-1', ?, 1, 1, ?)`).run(reqIdKey({ reqId: "REQ-104" }), "2026-08-12T12:00:00Z");
    db.prepare(`INSERT INTO verification_runs
      (project_id, project_version_id, generation_id, run_id, tier, matrix_col, kind, status, raw, synced_at)
      VALUES ('project-1', 'version-1', 'g-1', 'run-1', 'tier0', 'static', 'verification', 'completed', '{}', ?)`).run("2026-08-12T12:00:00Z");
    db.prepare(`INSERT INTO verification_results
      (project_id, project_version_id, generation_id, result_id, run_id, requirement_key, check_id, tier, status, evidence_summary, executed_at, is_latest, raw, pulled_at)
      VALUES ('project-1', 'version-1', 'g-1', 'result-1', 'run-1', ?, 'check-1', 'static', 'verified', 'Signature path verified.', ?, 1, '{}', ?)`).run(reqIdKey({ reqId: "REQ-104" }), "2026-08-12T12:00:00Z", "2026-08-12T12:00:00Z");
    db.prepare(`INSERT INTO attestations
      (project_id, project_version_id, generation_id, attestation_id, run_id, format, subject_digest, payload, signature_verified, subject_matches_run, verified, created_at, pulled_at)
      VALUES ('project-1', 'version-1', 'g-1', 'att-1', 'run-1', 'in-toto', 'firmware', '{}', 1, 1, 1, ?, ?)`).run("2026-08-12T12:00:00Z", "2026-08-12T12:00:00Z");
    registerRequirementsCardsBackend(host.bb, context);
    registerRequirementsTraceabilityBackend(host.bb, context);
    const result = rpcContract.requirementsList.output.parse(await host.harness.callRpc("requirementsList", {
      projectId: "project-1", projectVersionId: null, pageSize: 1, continuation: null,
      filters: { view: "traceability", requirementId: "REQ-104", pattern: ["event_driven"], tier: "static", standardClause: "EU-CRA/annex1-2c", threat: "THREAT-22" },
    }));
    expect(result.total).toBe(1);
    const fields = result.items[0]?.fields as unknown;
    const parsed = fields as TraceabilityListFields;
    expect(parsed.facets.pattern).toContainEqual({ value: "event_driven", count: 1 });
    expect(parsed.trace?.rail.nodes.map((node) => node.kind)).toEqual([
      "threat", "requirement", "clause", "commit", "check", "run", "attestation",
    ]);
    expect(parsed.trace?.rail.nodes.find((node) => node.kind === "clause")?.provenance?.source).toContain("review_version 4");
    expect(parsed.trace?.rail.gaps).toEqual([]);
    expect(host.harness.sdk.callsTo("files.list")).toHaveLength(1);
    const firstPage = rpcContract.requirementsList.output.parse(await host.harness.callRpc("requirementsList", {
      projectId: "project-1", projectVersionId: null, pageSize: 1, continuation: null,
      filters: { view: "traceability" },
    }));
    expect(firstPage.total).toBe(2);
    expect(firstPage.next).toBe("trace:v1:REQ-104");
    const secondPage = rpcContract.requirementsList.output.parse(await host.harness.callRpc("requirementsList", {
      projectId: "project-1", projectVersionId: null, pageSize: 1, continuation: firstPage.next,
      filters: { view: "traceability" },
    }));
    expect(secondPage.items.map((item) => item.key)).toEqual(["REQ-200"]);
    expect(secondPage.next).toBeNull();
    await host.harness.callRpc("requirementsList", {
      projectId: "project-1", projectVersionId: null, pageSize: 1, continuation: null,
      filters: { view: "traceability", text: "no match" },
    });
    expect(host.harness.sdk.callsTo("files.list")).toHaveLength(1);
    await host.harness.lifecycle.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects a malformed route id before any git runner or SDK call", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state" });
    const runner: GitHistoryRunner = { run: vi.fn(async () => "") };
    const result = await getRequirementGitHistory(host.bb, "project-1", "REQ-ok; touch /tmp/pwn", "a".repeat(64), runner);
    expect(result).toEqual({ error: "Requirement id is malformed; git history was not invoked." });
    expect(runner.run).not.toHaveBeenCalled();
    expect(host.harness.sdk.calls).toEqual([]);
    await host.harness.lifecycle.dispose();
  });
});

describe("requirements traceability UI", () => {
  it("offers traceability only from requirements and navigates to its canonical route", async () => {
    const { ProductSecurityHeader } = await import("../../ui/ProductSecurityHeader.js");
    const requirementsHeader = renderSlot(
      { component: ProductSecurityHeader },
      { subPath: "requirements" },
    );
    fireEvent.click(requirementsHeader.getByRole("button", { name: "Traceability" }));
    expect(requirementsHeader.inspection.navigateCalls).toContainEqual(expect.objectContaining({
      method: "toPluginPanel",
      path: "product-security",
      options: { subPath: "requirements/trace" },
    }));
    requirementsHeader.lifecycle.unmount();

    for (const subPath of ["requirements/trace", "tara"]) {
      const hiddenHeader = renderSlot(
        { component: ProductSecurityHeader },
        { subPath },
      );
      expect(hiddenHeader.queryByRole("button", { name: "Traceability" })).toBeNull();
      hiddenHeader.lifecycle.unmount();
    }
  });

  it("renders an unconfigured self-fetch state without calling RPC", async () => {
    const { SelfFetchingTraceRail } = await import("./index.js");
    const rpc = vi.fn(() => rpcPage({ card: card(), facets, trace: traceModel() }));
    const slot = renderSlot(
      { component: SelfFetchingTraceRail },
      { projectId: null, requirementId: "REQ-104" },
      { rpc: { requirementsList: rpc } },
    );
    expect(slot.getByText("Choose a project")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    slot.lifecycle.unmount();
  });

  it("self-fetches a rail by stable id and navigates threat nodes to the focused canvas", async () => {
    const { RequirementsTraceabilityLayer } = await import("./index.js");
    const inputs: unknown[] = [];
    const fields = { card: card(), facets, trace: traceModel() };
    const slot = renderSlot(
      { component: RequirementsTraceabilityLayer },
      { projectId: "project-1", detail: ["trace", "REQ-104"] },
      { rpc: { requirementsList: (input) => { inputs.push(input); return rpcPage(fields); } } },
    );
    expect(await slot.findByText("Inspectable trace")).toBeTruthy();
    expect(inputs[0]).toEqual(expect.objectContaining({ filters: expect.objectContaining({ view: "traceability", requirementId: "REQ-104" }) }));
    fireEvent.click(slot.getByLabelText("Focus COMP-updater in canvas"));
    expect(slot.inspection.navigateCalls).toContainEqual(expect.objectContaining({ method: "toPluginPanel", path: "product-security", options: { subPath: "tara/nodes/COMP-updater", replace: false } }));
    slot.lifecycle.unmount();
  });

  it("isolates missing-clause and failed-git gaps without blanking the chain", async () => {
    const { SelfFetchingTraceRail } = await import("./index.js");
    const trace = traceModel();
    trace.rail.nodes = trace.rail.nodes.filter((node) => node.kind !== "clause" && node.kind !== "commit");
    trace.rail.gaps = [
      { from: "REQ-104", to: "clause", reason: "Mapped clause is absent from cached standards truth." },
      { from: "clause", to: "commit", reason: "Git history unavailable: bounded lookup failed." },
    ];
    const slot = renderSlot(
      { component: SelfFetchingTraceRail },
      { projectId: "project-1", requirementId: "REQ-104" },
      { rpc: { requirementsList: () => rpcPage({ card: card(), facets, trace }) } },
    );
    expect(await slot.findByText("Mapped clause is absent from cached standards truth.")).toBeTruthy();
    expect(slot.getByText("Git history unavailable: bounded lookup failed.")).toBeTruthy();
    expect(slot.getByLabelText("requirement REQ-104: ready")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("renders no matching requirements as a designed empty state", async () => {
    const { RequirementsTraceabilityLayer } = await import("./index.js");
    const slot = renderSlot(
      { component: RequirementsTraceabilityLayer },
      { projectId: "project-1", detail: ["trace"] },
      { rpc: { requirementsList: () => ({ ...rpcPage({ card: card(), facets, trace: null }, 0), items: [] }) } },
    );
    expect(await slot.findByText("No matching requirements")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("keeps a 5,000-result fixture to a bounded virtualized DOM", async () => {
    const { RequirementsTraceabilityLayer } = await import("./index.js");
    const items = Array.from({ length: 5_000 }, (_, index) => {
      const nextCard = card(`REQ-${String(index).padStart(5, "0")}`);
      return { projectId: "project-1", projectVersionId: null, kind: "requirement-trace", key: nextCard.requirement.id, label: nextCard.requirement.id, fields: JSON.parse(JSON.stringify({ card: nextCard, facets, trace: null })) };
    });
    const slot = renderSlot(
      { component: RequirementsTraceabilityLayer },
      { projectId: "project-1", detail: ["trace"] },
      { rpc: { requirementsList: () => ({ ...rpcPage({ card: card(), facets, trace: null }, 5_000), items }) } },
    );
    await waitFor(() => expect(slot.container.querySelectorAll("[data-trace-result-row]").length).toBeGreaterThan(0));
    expect(slot.container.querySelectorAll("[data-trace-result-row]").length).toBeLessThan(30);
    slot.lifecycle.unmount();
  });
});

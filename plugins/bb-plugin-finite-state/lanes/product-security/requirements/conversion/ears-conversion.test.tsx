// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { reqIdKey } from "../../../../lib/sync/registry.js";
import { rpcContract } from "../../../../shared/contract.js";
import { serializeRequirement } from "../cards/adapter.js";
import type { EarsPattern, RequirementYamlV1 } from "../cards/schema.js";
import {
  buildConversionBundle,
  clearConversionBundlesForTests,
  getConversionBundlePage,
  type ConversionDeps,
  type ConversionPullSnapshot,
  type ConversionSource,
} from "./bundle.js";
import {
  conversionRpcContract,
  registerRequirementsConversionBackend,
} from "./backend.js";
import { ConversionDialog } from "./ConversionDialog.js";
import { buildDriftRerunBundle, detectConversionDrift } from "./drift.js";
import {
  clearConversionReportsForTests,
  recordHumanReview,
  refreshConversion,
  startConversion,
} from "./report.js";
import { buildConversionPrompt } from "./spawn.js";
import { validateConversion } from "./validate.js";
import { requirementEditSubPath } from "./index.js";

const PULLED_AT = "2026-08-12T12:00:00.000Z";

function source(
  id: string,
  description = `Original prose for ${id}`,
): ConversionSource {
  return {
    requirementId: id,
    remoteId: `remote-${id}`,
    targetPath: `product-security/requirements/${id}.yaml`,
    sourceDescription: description,
    reqType: "security",
    priority: "P1",
    status: "draft",
    rationale: null,
    traces: { mitigations: ["THREAT-1"], controls: [], standards: [] },
    checks: [
      {
        id: `check-id-${id}`,
        slug: `CHECK-${id}`,
        method: "config_check",
        tier: "static",
        required: true,
        coverage: "full",
        suppressed: false,
        description: "Inspect configuration.",
        passCriteria: `PASS EXACT ${id}`,
        failCriteria: `FAIL EXACT ${id}`,
        resultSummaries: Array.from({ length: 30 }, (_, index) => ({
          status: "verified",
          summary: `result ${index}`,
          executedAt: PULLED_AT,
        })),
      },
    ],
    sourceDigest: "",
  };
}

function snapshot(sources: ConversionSource[]): ConversionPullSnapshot {
  return {
    projectId: "project-1",
    pulledAt: PULLED_AT,
    requirements: sources,
    references: {
      requirements: new Map(
        sources.map((item) => [item.requirementId, item.remoteId]),
      ),
      checks: new Map(
        sources.flatMap((item) =>
          item.checks.map((check) => [check.slug, check.id]),
        ),
      ),
      mitigations: new Map([["THREAT-1", "remote-threat-1"]]),
      controls: new Map(),
      standards: new Map(),
    },
  };
}

function requirement(
  item: ConversionSource,
  pattern: EarsPattern = "ubiquitous",
): RequirementYamlV1 {
  const parts: RequirementYamlV1["ears"]["parts"] = {
    ...(pattern === "event_driven" ? { trigger: "an update arrives" } : {}),
    ...(pattern === "state_driven" ? { state: "the device is booting" } : {}),
    system: "the updater",
    response: "verify the signature",
  };
  const ears: RequirementYamlV1["ears"] = {
    pattern,
    parts,
    text:
      pattern === "event_driven"
        ? "When an update arrives, the updater shall verify the signature."
        : pattern === "state_driven"
          ? "While the device is booting, the updater shall verify the signature."
          : "The updater shall verify the signature.",
  };
  return {
    schema: "fs-requirement/v1",
    id: item.requirementId,
    req_type: item.reqType,
    priority: item.priority,
    status: item.status,
    ears,
    source_description: item.sourceDescription,
    mitigations: [...item.traces.mitigations],
    controls: [],
    standards: [],
    verification: item.checks.map((check) => ({
      check: check.slug,
      method: "config_check",
      tier: check.tier,
      required: check.required,
      coverage: "full",
      pass_criteria: check.passCriteria,
      fail_criteria: check.failCriteria ?? undefined,
    })),
  };
}

function fixture(initial: ConversionPullSnapshot) {
  let current = initial;
  let bundleNumber = 0;
  const files = new Map<string, string>();
  const deps: ConversionDeps = {
    projectId: "project-1",
    projectVersionId: "version-1",
    loadPullSnapshot: async () => current,
    readLocalFile: async (path) => files.get(path) ?? null,
    spawnOriginPluginThread: vi.fn(async () => ({ threadId: "thread-1" })),
    randomId: () => `bundle-${++bundleNumber}`,
  };
  return {
    deps,
    files,
    setSnapshot(next: ConversionPullSnapshot) {
      current = next;
    },
  };
}

afterEach(() => {
  cleanup();
  clearConversionBundlesForTests();
  clearConversionReportsForTests();
});

describe("EARS conversion flow", () => {
  it("bundle pages grounded source with bounded evidence summaries", async () => {
    const sources = Array.from({ length: 21 }, (_, index) =>
      source(`REQ-${index + 1}`),
    );
    const test = fixture(snapshot(sources));
    const meta = await buildConversionBundle(test.deps);
    expect(meta).toMatchObject({
      projectId: "project-1",
      pulledAt: PULLED_AT,
      requirementIds: sources.map((item) => item.requirementId),
    });
    expect(meta.snapshotDigest).toMatch(/^[a-f0-9]{64}$/u);
    const first = await getConversionBundlePage(meta.bundleId);
    expect(first.items).toHaveLength(20);
    expect(first.items[0]?.checks[0]?.resultSummaries).toHaveLength(20);
    await expect(
      getConversionBundlePage(meta.bundleId, first.nextCursor ?? undefined),
    ).resolves.toMatchObject({
      nextCursor: null,
      items: [{ requirementId: "REQ-21" }],
    });
  });

  it("spawn context is bounded and covers six patterns and prohibitions", async () => {
    const test = fixture(
      snapshot([source("REQ-1", "SECRET SOURCE BODY MUST NOT BE IN PROMPT")]),
    );
    const meta = await buildConversionBundle(test.deps);
    const prompt = buildConversionPrompt(meta, [
      "product-security/requirements/REQ-1.yaml",
    ]);
    expect(prompt).toContain(meta.bundleId);
    expect(prompt).not.toContain("SECRET SOURCE BODY");
    for (const pattern of [
      "ubiquitous",
      "event_driven",
      "state_driven",
      "unwanted_behavior",
      "optional_feature",
      "complex",
    ])
      expect(prompt).toContain(pattern);
    expect(prompt).toContain("Do not push");
    expect(prompt).toContain(
      "Copy every mapped check's pass_criteria and fail_criteria verbatim",
    );
    await startConversion(test.deps, ["REQ-1"]);
    const spawnInput = vi
      .mocked(test.deps.spawnOriginPluginThread)
      .mock.calls.at(-1)?.[0];
    expect(spawnInput?.bundlePages).toHaveLength(1);
    expect(spawnInput?.bundlePages[0]?.content).toContain(
      "SECRET SOURCE BODY MUST NOT BE IN PROMPT",
    );
    expect(spawnInput?.prompt).toContain(spawnInput?.bundlePages[0]?.filename);
  });

  it("three valid requirements pass gates 1–2 and await human", async () => {
    const sources = [source("REQ-1"), source("REQ-2"), source("REQ-3")];
    const test = fixture(snapshot(sources));
    await buildConversionBundle(test.deps);
    const patterns: EarsPattern[] = [
      "ubiquitous",
      "event_driven",
      "state_driven",
    ];
    sources.forEach((item, index) =>
      test.files.set(
        item.targetPath,
        serializeRequirement(
          requirement(item, patterns[index] ?? "ubiquitous"),
        ),
      ),
    );
    const gates = await validateConversion(
      sources.map((item) => item.targetPath),
    );
    expect(gates).toHaveLength(3);
    expect(gates.every((gate) => gate.schema.ok && gate.roundTrip.ok)).toBe(
      true,
    );
    expect(gates.every((gate) => gate.humanReview === "pending")).toBe(true);
  });

  it("only an explicit review action satisfies gate 3", async () => {
    const item = source("REQ-1");
    const test = fixture(snapshot([item]));
    test.files.set(item.targetPath, serializeRequirement(requirement(item)));
    const running = await startConversion(test.deps, [item.requirementId]);
    expect(running).toMatchObject({ state: "running", threadId: "thread-1" });
    const awaitingHuman = await refreshConversion(running.id);
    expect(awaitingHuman).toMatchObject({
      state: "awaiting_human",
      gates: [{ humanReview: "pending" }],
    });
    const reviewed = recordHumanReview(
      running.id,
      "reviewed",
      awaitingHuman.snapshotSha256,
    );
    expect(reviewed).toMatchObject({
      state: "reviewed",
      gates: [{ humanReview: "reviewed" }],
    });
  });

  it("renders the byte-path diff without a sync worktree and fails closed on review", async () => {
    const item = source("REQ-1");
    const backendItem: ConversionSource = {
      ...item,
      traces: { mitigations: [], controls: [], standards: [] },
    };
    const proposal = serializeRequirement(requirement(backendItem));
    const host = createFakePluginHost({
      pluginId: "finite-state",
      sdk: {
        projects: {
          get: async () => ({
            sources: [
              { hostId: "host-1", path: "/workspace", isDefault: true },
            ],
          }),
          attachments: {
            upload: async (input) => ({
              type: "localFile" as const,
              path: `uploaded/${input.filename ?? "bundle.json"}`,
              name: input.filename ?? "bundle.json",
              mimeType: "application/json",
              sizeBytes: 1,
            }),
          },
        },
        files: {
          read: async () => ({
            content: proposal,
            contentEncoding: "utf8" as const,
            sha256: "a".repeat(64),
          }),
        },
        threads: { spawn: async () => ({ id: "thread-conversion" }) },
      },
    });
    const ctx = createPluginContext(host.bb);
    const db = ctx.db();
    const requirementKey = reqIdKey({ reqId: item.requirementId });
    db.prepare(
      `INSERT INTO pull_generation
         (project_id, project_version_id, generation_id, status, requested_kinds_json,
          started_at, completed_at, accepted_at, error)
       VALUES (?, ?, ?, 'accepted', '[]', ?, ?, ?, NULL)`,
    ).run(
      "project-1",
      "version-1",
      "generation-1",
      PULLED_AT,
      PULLED_AT,
      PULLED_AT,
    );
    db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id,
          staging_generation_id, base_revision, last_pull)
       VALUES (?, ?, 'requirement', ?, NULL, 1, ?)`,
    ).run("project-1", "version-1", "generation-1", PULLED_AT);
    db.prepare(
      `INSERT INTO base_snapshot
         (project_id, project_version_id, entity_kind, generation_id, entity_key,
          remote_id, payload, content_hash, pulled_at)
       VALUES (?, ?, 'requirement', ?, ?, ?, ?, ?, ?)`,
    ).run(
      "project-1",
      "version-1",
      "generation-1",
      requirementKey,
      item.remoteId,
      JSON.stringify({
        reqId: item.requirementId,
        description: item.sourceDescription,
        priority: "P1",
      }),
      "b".repeat(64),
      PULLED_AT,
    );
    db.prepare(
      `INSERT INTO id_map
         (project_id, project_version_id, entity_kind, generation_id, entity_key, remote_id, pulled_at)
       VALUES (?, ?, 'requirement', ?, ?, ?, ?)`,
    ).run(
      "project-1",
      "version-1",
      "generation-1",
      requirementKey,
      item.remoteId,
      PULLED_AT,
    );
    db.prepare(
      `INSERT INTO verification_checks
         (project_id, project_version_id, generation_id, check_id, code, name, check_type,
          category, description, pass_criteria, fail_criteria, input_description, parameters,
          default_sla_days, deleted_at, review_status, review_version, raw, pulled_at)
       VALUES (?, ?, ?, ?, ?, 'Signature check', 'config_check', NULL, ?, ?, ?, NULL, NULL,
               NULL, NULL, NULL, '1', ?, ?)`,
    ).run(
      "project-1",
      "version-1",
      "generation-1",
      item.checks[0]?.id,
      item.checks[0]?.slug,
      item.checks[0]?.description,
      item.checks[0]?.passCriteria,
      item.checks[0]?.failCriteria,
      JSON.stringify({ tier: "static" }),
      PULLED_AT,
    );
    db.prepare(
      `INSERT INTO requirement_check_mappings
         (project_id, project_version_id, generation_id, requirement_key, check_id,
          is_required, coverage_level, suppressed, raw, pulled_at)
       VALUES (?, ?, ?, ?, ?, 1, 'full', 0, '{}', ?)`,
    ).run(
      "project-1",
      "version-1",
      "generation-1",
      requirementKey,
      item.checks[0]?.id,
      PULLED_AT,
    );

    registerRequirementsConversionBackend(host.bb, ctx);
    expect([...host.harness.registrations.rpcMethods].sort()).toEqual([
      "earsConversionGet",
      "earsConversionReview",
      "earsConversionStart",
    ]);
    const startInput = {
      projectId: "project-1",
      projectVersionId: "version-1",
      requirementIds: ["REQ-1"],
    };
    db.prepare(
      "UPDATE base_snapshot SET remote_id = NULL WHERE entity_kind = 'requirement'",
    ).run();
    await expect(
      host.harness.callRpc("earsConversionStart", startInput),
    ).rejects.toThrow(
      "Pulled requirement REQ-1 has no remote identity. Pull it again before converting.",
    );
    db.prepare(
      "UPDATE base_snapshot SET remote_id = ? WHERE entity_kind = 'requirement'",
    ).run(item.remoteId);
    const started = rpcContract.earsConversionStart.output.parse(
      await host.harness.callRpc("earsConversionStart", {
        ...startInput,
      }),
    );
    expect(started).toMatchObject({
      state: "running",
      threadId: "thread-conversion",
    });
    const validated = conversionRpcContract.earsConversionGet.output.parse(
      await host.harness.callRpc("earsConversionGet", {
        projectId: "project-1",
        projectVersionId: "version-1",
        id: started.id,
      }),
    );
    expect(validated).toMatchObject({
      state: "awaiting_human",
      errors: [],
      diffComplete: true,
      diff: [
        {
          label: "REQ-1",
          operation: "update",
          fields: expect.arrayContaining([
            expect.objectContaining({ field: "ears" }),
          ]),
        },
      ],
    });
    render(
      <ConversionDialog
        model={validated}
        onClose={vi.fn()}
        onDiscard={vi.fn()}
        onEdit={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText("REQ-1 · update")).toBeTruthy();
    expect(screen.getAllByText(/Before:/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Proposal:/u).length).toBeGreaterThan(0);
    await expect(
      host.harness.callRpc("earsConversionReview", {
        projectId: "project-1",
        projectVersionId: "version-1",
        id: started.id,
        decision: "reviewed",
        expectedSnapshotSha256: started.snapshotSha256,
      }),
    ).rejects.toThrow("authorization-unavailable");
    await expect(
      host.harness.callRpc("earsConversionReview", {
        projectId: "project-1",
        projectVersionId: "version-1",
        id: started.id,
        decision: "discarded",
        expectedSnapshotSha256: validated.snapshotSha256,
      }),
    ).resolves.toMatchObject({ state: "discarded" });
    expect(host.harness.sdk.callsTo("threads.spawn")[0]?.[0]).toEqual(
      expect.objectContaining({
        environment: { type: "project-default" },
        input: expect.arrayContaining([
          expect.objectContaining({ type: "localFile" }),
        ]),
        origin: "plugin",
        originPluginId: "finite-state",
      }),
    );
    await host.harness.lifecycle.dispose();
  });

  it("agent invention and derived fields fail gates with file and line", async () => {
    const item = source("REQ-1");
    const test = fixture(snapshot([item]));
    await buildConversionBundle(test.deps);
    const original = requirement(item);
    const contract = original.verification[0];
    if (!contract)
      throw new Error("The fixture must contain a verification contract.");
    const yaml = `${serializeRequirement({
      ...original,
      verification: [{ ...contract, check: "CHECK-INVENTED" }],
    })}verification_status: verified\n`;
    test.files.set(item.targetPath, yaml);
    const [gate] = await validateConversion([item.targetPath]);
    expect(gate?.schema.ok).toBe(false);
    expect(gate?.schema.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DERIVED_FIELD",
          artifactId: item.targetPath,
          line: expect.any(Number),
        }),
      ]),
    );
    expect(gate?.roundTrip).toMatchObject({
      ok: false,
      unresolved: ["CHECK-INVENTED"],
    });
  });

  it("drift rerun scopes changed inputs and staleness requires rebuild", async () => {
    const first = source("REQ-1");
    const second = source("REQ-2");
    const test = fixture(snapshot([first, second]));
    const meta = await buildConversionBundle(test.deps);
    test.files.set(first.targetPath, serializeRequirement(requirement(first)));
    test.files.set(
      second.targetPath,
      serializeRequirement(requirement(second)),
    );
    test.setSnapshot(snapshot([first, source("REQ-2", "Upstream changed")]));
    await expect(detectConversionDrift(meta.bundleId)).resolves.toMatchObject({
      driftedRequirementIds: ["REQ-2"],
      unchangedRequirementIds: ["REQ-1"],
    });
    await expect(buildDriftRerunBundle(meta.bundleId)).resolves.toMatchObject({
      requirementIds: ["REQ-2"],
    });
    const gates = await validateConversion([
      first.targetPath,
      second.targetPath,
    ]);
    expect(
      gates.find((gate) => gate.requirementId === "REQ-1")?.roundTrip
        .staleSource,
    ).toBe(false);
    expect(
      gates.find((gate) => gate.requirementId === "REQ-2")?.roundTrip
        .staleSource,
    ).toBe(true);
  });

  it("keeps gate 2 bound to the report bundle when a newer bundle owns the same path", async () => {
    const item = source("REQ-1");
    const test = fixture(snapshot([item]));
    test.files.set(item.targetPath, serializeRequirement(requirement(item)));
    const running = await startConversion(test.deps, [item.requirementId]);
    test.setSnapshot(snapshot([{ ...item, priority: "P0" }]));
    await expect(refreshConversion(running.id)).resolves.toMatchObject({
      state: "failed",
      gates: [{ roundTrip: { staleSource: true } }],
    });
    await buildConversionBundle(test.deps, [item.requirementId]);
    await expect(refreshConversion(running.id)).resolves.toMatchObject({
      state: "failed",
      gates: [{ roundTrip: { staleSource: true } }],
    });
  });

  it("recomputes the review fence from current proposal and upstream bytes", async () => {
    const item = source("REQ-1");
    const test = fixture(snapshot([item]));
    test.files.set(item.targetPath, serializeRequirement(requirement(item)));
    const running = await startConversion(test.deps, [item.requirementId]);
    const firstRefresh = await refreshConversion(running.id);
    const edited = requirement(item);
    edited.ears = {
      pattern: "ubiquitous",
      parts: { system: "the updater", response: "reject unsigned updates" },
      text: "The updater shall reject unsigned updates.",
    };
    test.files.set(item.targetPath, serializeRequirement(edited));
    const proposalRefresh = await refreshConversion(running.id);
    expect(proposalRefresh.snapshotSha256).not.toBe(
      firstRefresh.snapshotSha256,
    );
    expect(() =>
      recordHumanReview(running.id, "reviewed", firstRefresh.snapshotSha256),
    ).toThrow("changed after this diff was opened");
    test.setSnapshot(snapshot([{ ...item, priority: "P0" }]));
    const upstreamRefresh = await refreshConversion(running.id);
    expect(upstreamRefresh.snapshotSha256).not.toBe(
      proposalRefresh.snapshotSha256,
    );
  });

  it("uses the WP-37 detail route", () => {
    expect(requirementEditSubPath("REQ-1")).toBe("requirements/trace/REQ-1");
  });

  it("discard navigation never claims review and leaves source unchanged", () => {
    const discard = vi.fn();
    render(
      <ConversionDialog
        model={{
          id: "bundle",
          projectVersionId: "version-1",
          state: "failed",
          requirementIds: ["REQ-1"],
          snapshotSha256: "a".repeat(64),
          errors: [],
        }}
        onClose={vi.fn()}
        onDiscard={discard}
        onEdit={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Approve local proposal" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText(/pending an owner ruling/u)).toBeTruthy();
    screen.getByRole("button", { name: "Discard" }).click();
    expect(discard).toHaveBeenCalledOnce();
    expect(
      screen.getByText(/Nothing here pushes or applies server state/u),
    ).toBeTruthy();
  });
});

import { defineRpcContract } from "@bb/plugin-sdk";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AGENT_ACTION_RPC_METHODS,
  CONTRACT_VERSION,
  HUMAN_APPROVAL_CAPABILITY_POLICY,
  HUMAN_ONLY_RPC_METHODS,
  RPC_METHOD_CLASSIFICATIONS,
  RPC_WIRE_METHODS,
  documentSourceRefSchema,
  entitySummarySchema,
  humanApprovalCapabilitySchema,
  jsonValueSchema,
  pageRequestFields,
  projectScopeSchema,
  rpcContract,
  syncPlanFenceSchema,
  validationErrorSchema,
} from "./contract.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const CAPABILITY = `fs-human-approval-v1.${"x".repeat(48)}`;

const EXPECTED_LOGICAL_METHODS = [
  "authoring.citations.list",
  "authoring.gate.status",
  "authoring.quarantine.list",
  "benchDev.device.claim",
  "benchDev.device.release",
  "benchDev.devices.list",
  "benchDev.runs.list",
  "benchDev.serial.session.get",
  "bench.hosts.joinCode",
  "bench.hosts.list",
  "bench.logs.list",
  "bench.run.get",
  "bench.run.start",
  "bench.runs.list",
  "bench.verdict.get",
  "bom.component.get",
  "bom.software.list",
  "connections.status",
  "documents.extractions.list",
  "documents.get",
  "documents.list",
  "documents.metadata.update",
  "documents.search",
  "ears.conversion.get",
  "ears.conversion.review",
  "ears.conversion.start",
  "findings.activity.list",
  "findings.comments.create",
  "findings.comments.delete",
  "findings.comments.list",
  "findings.comments.update",
  "findings.facets",
  "findings.get",
  "findings.list",
  "firmware.diff",
  "firmware.file.get",
  "firmware.file.hydrate",
  "firmware.input.issue",
  "firmware.materialize.cancel",
  "firmware.materialize.start",
  "firmware.mount.get",
  "firmware.mounts.list",
  "firmware.tree.list",
  "grounding.coverage.get",
  "grounding.query",
  "grounding.sources.list",
  "hardware.artifacts.status",
  "hardware.extract.start",
  "hardware.extract.status",
  "hardware.nets.list",
  "hardware.part.get",
  "hardware.projects.list",
  "hardware.sheets.list",
  "hardware.symbols.list",
  "hardware.violations.list",
  "hbom.extraction.apply",
  "hbom.review.list",
  "hbom.review.resolve",
  "requirements.get",
  "requirements.list",
  "requirements.write",
  "review.transition",
  "sync.conflict.resolve",
  "sync.asProject.candidates",
  "sync.asProject.select",
  "sync.plan",
  "sync.pull",
  "sync.push",
  "sync.push.retry",
  "sync.status",
  "tara.command.apply",
  "tara.deleteImpact",
  "tara.get",
  "tara.list",
  "triage.decision.bulkWrite",
  "triage.decision.undo",
  "triage.decision.write",
  "triage.orphans.prune",
  "triage.policy.apply",
  "triage.policy.preview",
  "triage.run.get",
  "triage.vendorVex.apply",
  "triage.vendorVex.preview",
  "verifications.manualAttestation.record",
  "verifications.matrix",
  "verifications.run.get",
  "verifications.run.start",
  "workspace.summary",
] as const;

const AMD_0011_CURSOR_PAGED_METHODS = new Set([
  "hardwareProjectsList",
  "hardwareSymbolsList",
  "hardwareNetsList",
  "hardwareViolationsList",
  "hardwareSheetsList",
  "groundingSourcesList",
  "groundingQuery",
  "authoringCitationsList",
  "authoringQuarantineList",
  "benchDevDevicesList",
  "benchDevRunsList",
]);

const PROJECT_KEY_DOMAIN_METHODS = new Set([
  // Owner-ratified AMD-0011 exception: this is the project-relative KiCad
  // artifact key, not an alias for projectId/projectVersionId scope.
  "hardwareSymbolsList",
  "hardwareNetsList",
  "hardwareViolationsList",
  "hardwareSheetsList",
  "hardwarePartGet",
  "hardwareArtifactsStatus",
  "hardwareExtractStart",
  "groundingSourcesList",
]);

const UN_SCOPED_METHODS = new Set([
  "connectionsStatus",
  "benchHostsList",
  "benchHostsJoinCode",
]);

function lowerCamelWireName(logicalName: string): string {
  return logicalName
    .split(".")
    .map((segment, index) =>
      index === 0
        ? segment
        : `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`,
    )
    .join("");
}

function objectVariants(schema: z.ZodType): z.ZodObject[] {
  if (schema instanceof z.ZodObject) return [schema];
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const variants: z.ZodObject[] = [];
    for (const option of schema.options) {
      if (option instanceof z.ZodObject) variants.push(option);
    }
    return variants;
  }
  return [];
}

function objectField(
  schema: z.ZodObject,
  field: string,
): z.ZodType | undefined {
  const candidate: unknown = Reflect.get(schema.shape, field);
  return candidate instanceof z.ZodType ? candidate : undefined;
}

describe("rpc-contract-freeze", () => {
  it("exports version nine and all 88 bijective logical-to-wire names", () => {
    expect(CONTRACT_VERSION).toBe(9);
    expect(Object.keys(RPC_WIRE_METHODS).sort()).toEqual(
      [...EXPECTED_LOGICAL_METHODS].sort(),
    );
    expect(Object.keys(RPC_WIRE_METHODS)).toHaveLength(88);

    const wireNames = Object.values(RPC_WIRE_METHODS);
    expect(new Set(wireNames).size).toBe(88);
    expect(Object.keys(rpcContract).sort()).toEqual([...wireNames].sort());
    for (const [logicalName, wireName] of Object.entries(RPC_WIRE_METHODS)) {
      expect(wireName).toBe(lowerCamelWireName(logicalName));
    }
  });

  it("allows a null after-hash only for TARA deletion and rejects empty writes", () => {
    const localWriteMethods = [
      "triageDecisionWrite",
      "triageDecisionUndo",
      "taraCommandApply",
      "requirementsWrite",
    ] as const;
    const created = {
      projectId: "project-1",
      projectVersionId: null,
      stableKey: "entity-1",
      beforeSha256: null,
      afterSha256: SHA_A,
      changedFields: ["name"],
      diffSummary: "create entity-1",
    };
    const deleted = {
      ...created,
      beforeSha256: SHA_A,
      afterSha256: null,
      diffSummary: "delete entity-1",
    };
    const emptyWrite = {
      ...created,
      beforeSha256: null,
      afterSha256: null,
      changedFields: [],
      diffSummary: "no write",
    };

    expect(
      localWriteMethods.filter(
        (method) => rpcContract[method].output.safeParse(deleted).success,
      ),
    ).toEqual(["taraCommandApply"]);
    for (const method of localWriteMethods) {
      expect(
        rpcContract[method].output.safeParse(created).success,
        `${method} must continue to accept create/update hashes`,
      ).toBe(true);
      expect(
        rpcContract[method].output.safeParse(emptyWrite).success,
        `${method} must reject a write with no before or after bytes`,
      ).toBe(false);
    }
    expect(
      objectVariants(rpcContract.taraCommandApply.input)
        .filter(
          (variant) =>
            objectField(variant, "operation")?.safeParse("delete").success,
        )
        .map((variant) => Object.keys(variant.shape).sort()),
    ).toEqual([
      [
        "expectedContentSha256",
        "kind",
        "mode",
        "operation",
        "projectId",
        "projectVersionId",
        "stableKey",
      ],
    ]);
  });

  it("registers every mapped wire key under the actual SDK rule and rejects dots", () => {
    const { bb } = createFakePluginHost({ pluginId: "finite-state-contract" });
    for (const wireName of Object.values(RPC_WIRE_METHODS)) {
      const singletonContract = defineRpcContract({
        [wireName]: { input: z.null(), output: z.null() },
      });
      bb.rpc.register(singletonContract, { [wireName]: () => null });
    }

    const dottedContract = defineRpcContract({
      "sync.pull": { input: z.null(), output: z.null() },
    });
    expect(() =>
      bb.rpc.register(dottedContract, { "sync.pull": () => null }),
    ).toThrow('invalid rpc method name "sync.pull"');
  });

  it("classifies every method exactly once and keeps the agent action allowlist at three", () => {
    expect(Object.keys(RPC_METHOD_CLASSIFICATIONS).sort()).toEqual(
      Object.values(RPC_WIRE_METHODS).sort(),
    );
    expect(
      Object.entries(RPC_METHOD_CLASSIFICATIONS)
        .filter(([, classification]) => classification === "human-only")
        .map(([method]) => method)
        .sort(),
    ).toEqual([
      "findingsCommentsCreate",
      "findingsCommentsDelete",
      "findingsCommentsUpdate",
      "hbomExtractionApply",
      "hbomReviewResolve",
      "reviewTransition",
      "syncConflictResolve",
      "syncPush",
      "syncPushRetry",
      "verificationsManualAttestationRecord",
    ]);
    expect([...HUMAN_ONLY_RPC_METHODS].sort()).toEqual([
      "findingsCommentsCreate",
      "findingsCommentsDelete",
      "findingsCommentsUpdate",
      "hbomExtractionApply",
      "hbomReviewResolve",
      "reviewTransition",
      "syncConflictResolve",
      "syncPush",
      "syncPushRetry",
      "verificationsManualAttestationRecord",
    ]);
    expect(AGENT_ACTION_RPC_METHODS).toEqual([
      "verificationsRunStart",
      "firmwareMaterializeStart",
      "benchRunStart",
    ]);
    expect(RPC_METHOD_CLASSIFICATIONS.firmwareInputIssue).toBe("action");
    expect(AGENT_ACTION_RPC_METHODS).not.toContain("firmwareInputIssue");
  });

  it("keeps firmware input issuance non-null, relative, and path-redacted", () => {
    expect(
      rpcContract.firmwareInputIssue.input.parse({
        projectId: "project-1",
        projectVersionId: "pv-1",
        environmentId: "environment-1",
        firmwarePath: "artifacts/firmware.bin",
      }),
    ).toEqual({
      projectId: "project-1",
      projectVersionId: "pv-1",
      environmentId: "environment-1",
      firmwarePath: "artifacts/firmware.bin",
    });
    expect(
      rpcContract.firmwareInputIssue.input.safeParse({
        projectId: "project-1",
        projectVersionId: null,
        environmentId: "environment-1",
        firmwarePath: "artifacts/firmware.bin",
      }).success,
    ).toBe(false);
    expect(
      rpcContract.firmwareInputIssue.input.safeParse({
        projectId: "project-1",
        projectVersionId: "pv-1",
        environmentId: "environment-1",
        firmwarePath: "/tmp/firmware.bin",
      }).success,
    ).toBe(false);
    expect(
      Object.keys(rpcContract.firmwareInputIssue.output.shape),
    ).not.toContain("firmwarePath");
  });

  it("requires explicit project coordinates and rejects the internal sentinel", () => {
    expect(
      projectScopeSchema.parse({
        projectId: "101",
        projectVersionId: "202",
      }),
    ).toEqual({ projectId: "101", projectVersionId: "202" });
    expect(
      projectScopeSchema.parse({ projectId: "101", projectVersionId: null }),
    ).toEqual({ projectId: "101", projectVersionId: null });
    expect(
      projectScopeSchema.safeParse({
        projectId: "101",
        projectVersionId: "@project",
      }).success,
    ).toBe(false);

    for (const [method, contract] of Object.entries(rpcContract)) {
      if (UN_SCOPED_METHODS.has(method)) continue;
      const variants = objectVariants(contract.input);
      expect(
        variants.length,
        `${method} must have a scoped object input`,
      ).toBeGreaterThan(0);
      for (const variant of variants) {
        expect(variant.shape, `${method} projectId`).toHaveProperty(
          "projectId",
        );
        expect(variant.shape, `${method} projectVersionId`).toHaveProperty(
          "projectVersionId",
        );
      }
    }
  });

  it("keeps all input objects strict and excludes every rejected scope/auth alias", () => {
    const forbiddenFields = [
      "workspaceId",
      "scope",
      "scopeId",
      "pvId",
      "projectKey",
      "confirmed",
      "yes",
    ];
    for (const [method, contract] of Object.entries(rpcContract)) {
      for (const input of objectVariants(contract.input)) {
        expect(
          input.partial().safeParse({ unexpectedTransportField: true }).success,
          `${method} must reject unknown input keys`,
        ).toBe(false);
        const keys = Object.keys(input.shape);
        for (const forbiddenField of forbiddenFields) {
          if (
            forbiddenField === "projectKey" &&
            PROJECT_KEY_DOMAIN_METHODS.has(method)
          ) {
            continue;
          }
          expect(keys, `${method} exposes ${forbiddenField}`).not.toContain(
            forbiddenField,
          );
        }
      }
    }
  });

  it("uses one opaque continuation/page-size vocabulary on every paged contract", () => {
    expect(pageRequestFields.pageSize.safeParse(1).success).toBe(true);
    expect(pageRequestFields.pageSize.safeParse(200).success).toBe(true);
    expect(pageRequestFields.pageSize.safeParse(0).success).toBe(false);
    expect(pageRequestFields.pageSize.safeParse(201).success).toBe(false);
    expect(pageRequestFields.continuation.parse("opaque-token")).toBe(
      "opaque-token",
    );

    let pagedMethods = 0;
    for (const [method, contract] of Object.entries(rpcContract)) {
      for (const input of objectVariants(contract.input)) {
        const inputKeys = Object.keys(input.shape);
        if (AMD_0011_CURSOR_PAGED_METHODS.has(method)) {
          pagedMethods += 1;
          expect(inputKeys).toContain("pageSize");
          expect(inputKeys).toContain("cursor");
          expect(inputKeys).not.toContain("continuation");
          expect(inputKeys).not.toContain("offset");
          expect(inputKeys).not.toContain("limit");
          expect(contract.output).toBeInstanceOf(z.ZodObject);
          if (contract.output instanceof z.ZodObject) {
            const outputKeys = Object.keys(contract.output.shape);
            expect(outputKeys).toContain("items");
            expect(outputKeys).toContain("total");
            expect(outputKeys).toContain("cursor");
            expect(outputKeys).not.toContain("next");
            expect(
              objectField(contract.output, "total")?.safeParse(null).success,
            ).toBe(false);
            expect(
              objectField(contract.output, "cursor")?.safeParse(null).success,
            ).toBe(true);
          }
          continue;
        }
        expect(inputKeys, `${method} leaks cursor`).not.toContain("cursor");
        expect(inputKeys, `${method} leaks offset`).not.toContain("offset");
        expect(inputKeys, `${method} leaks limit`).not.toContain("limit");
        expect(inputKeys, `${method} leaks sequence paging`).not.toContain(
          "afterSeq",
        );
        if (!inputKeys.includes("pageSize")) continue;
        pagedMethods += 1;
        expect(inputKeys).toContain("continuation");
        expect(objectField(input, "pageSize")?.safeParse(0).success).toBe(
          false,
        );
        expect(objectField(input, "pageSize")?.safeParse(201).success).toBe(
          false,
        );

        expect(contract.output).toBeInstanceOf(z.ZodObject);
        if (contract.output instanceof z.ZodObject) {
          const outputKeys = Object.keys(contract.output.shape);
          expect(outputKeys).toContain("items");
          expect(outputKeys).toContain("total");
          expect(outputKeys).toContain("next");
          expect(outputKeys).not.toContain("cursor");
          expect(
            objectField(contract.output, "total")?.safeParse(null).success,
          ).toBe(true);
          expect(
            objectField(contract.output, "next")?.safeParse("opaque-next")
              .success,
          ).toBe(true);
        }
      }
    }
    expect(pagedMethods).toBeGreaterThan(15);
  });

  it("keeps every AMD-0011 list method on the items-total-cursor shape", () => {
    const listMethods = Object.entries(RPC_WIRE_METHODS)
      .filter(([logical]) =>
        /^(?:hardware|grounding|authoring|benchDev)\..*\.list$/u.test(logical),
      )
      .map(([, wire]) => wire);
    expect(listMethods.sort()).toEqual(
      [...AMD_0011_CURSOR_PAGED_METHODS]
        .filter((method) => method !== "groundingQuery")
        .sort(),
    );
    for (const method of listMethods) {
      const contract = rpcContract[method];
      expect(contract.output).toBeInstanceOf(z.ZodObject);
      if (contract.output instanceof z.ZodObject) {
        expect(Object.keys(contract.output.shape)).toEqual(
          expect.arrayContaining(["items", "total", "cursor"]),
        );
      }
    }
  });

  it("carries generation, revision, base-state, per-item, and plan fences", () => {
    expect(
      syncPlanFenceSchema.parse({
        planId: "plan-1",
        planSha256: SHA_A,
        baseGenerationIds: { findings: "generation-9" },
        baseRevisions: { findings: 14 },
        baseStateSha256: SHA_B,
      }),
    ).toMatchObject({
      planSha256: SHA_A,
      baseGenerationIds: { findings: "generation-9" },
      baseRevisions: { findings: 14 },
      baseStateSha256: SHA_B,
    });
    expect(
      syncPlanFenceSchema.safeParse({
        planId: "plan-1",
        planSha256: SHA_A,
        baseGenerationIds: { findings: "generation-9" },
        baseRevisions: { findings: -1 },
        baseStateSha256: SHA_B,
      }).success,
    ).toBe(false);

    const pushShape = rpcContract.syncPush.input.shape;
    expect(pushShape).toHaveProperty("expectedPlanSha256");
    expect(pushShape).toHaveProperty("expectedBaseStateSha256");
    expect(pushShape).not.toHaveProperty("planSha256");
    expect(pushShape).not.toHaveProperty("kindFences");
    expect(rpcContract.syncConflictResolve.input.shape).toHaveProperty(
      "expectedBaseContentHash",
    );
    expect(rpcContract.syncPlan.output.shape).toHaveProperty(
      "baseGenerationIds",
    );
    expect(rpcContract.syncPlan.output.shape).toHaveProperty("baseRevisions");
    expect(rpcContract.syncPull.output.shape).toHaveProperty("generationId");
    expect(rpcContract.syncPull.output.shape).toHaveProperty("acceptedAt");
    const pullKinds = rpcContract.syncPull.output.shape.kinds;
    expect(
      pullKinds.safeParse({
        finding: { fetched: 3, baseRows: 2, quarantined: 1 },
      }).success,
    ).toBe(true);
    expect(
      pullKinds.safeParse({ finding: { fetched: 3, baseRows: 2 } }).success,
    ).toBe(false);
    expect(rpcContract.syncPull.input.shape).toHaveProperty(
      "workspaceProjectId",
    );
    expect(rpcContract.syncStatus.input.shape).toHaveProperty(
      "workspaceProjectId",
    );
    expect(rpcContract.syncPlan.input.shape).toHaveProperty(
      "workspaceProjectId",
    );
    expect(rpcContract.syncStatus.output.shape).toHaveProperty(
      "acceptedGenerationIds",
    );
    expect(rpcContract.syncStatus.output.shape).toHaveProperty(
      "stagingGenerationIds",
    );
  });

  it("reserves an opaque capability for every human-only mutation but exposes no mint", () => {
    expect(HUMAN_APPROVAL_CAPABILITY_POLICY).toMatchObject({
      minting: "unavailable",
      mintSurfaces: [],
      requiredIssuer: "actor-authenticated-server",
      handlerDisposition: "authorization-unavailable",
      singleUse: true,
    });
    expect(HUMAN_APPROVAL_CAPABILITY_POLICY.bindings).toEqual([
      "actor",
      "action",
      "projectId",
      "projectVersionId",
      "planOrSnapshotDigest",
    ]);
    expect(HUMAN_APPROVAL_CAPABILITY_POLICY.rejectedEvidence).toEqual([
      "caller-boolean",
      "cli-yes",
      "plugin-token",
      "request-input",
    ]);
    expect(humanApprovalCapabilitySchema.safeParse("confirmed").success).toBe(
      false,
    );
    expect(humanApprovalCapabilitySchema.safeParse(CAPABILITY).success).toBe(
      true,
    );

    for (const method of HUMAN_ONLY_RPC_METHODS) {
      const variants = objectVariants(rpcContract[method].input);
      expect(variants).toHaveLength(1);
      expect(variants[0]?.shape, `${method} capability`).toHaveProperty(
        "humanApprovalCapability",
      );
      expect(
        variants[0]?.shape,
        `${method} confirmed alias`,
      ).not.toHaveProperty("confirmed");
    }
    expect(
      Object.keys(rpcContract).some((method) =>
        /mint|capability/iu.test(method),
      ),
    ).toBe(false);
  });

  it("accepts numeric-string identities and rejects unknown input seams", () => {
    expect(
      rpcContract.findingsGet.input.parse({
        projectId: "123",
        projectVersionId: "456",
        findingId: "789",
      }),
    ).toEqual({ projectId: "123", projectVersionId: "456", findingId: "789" });
    expect(
      rpcContract.findingsList.input.safeParse({
        projectId: "123",
        projectVersionId: "456",
        pageSize: 20,
        continuation: null,
        cursor: "leaked-offset-codec",
      }).success,
    ).toBe(false);
    expect(
      rpcContract.syncPlan.input.safeParse({
        projectId: "123",
        projectVersionId: null,
        scope: "project:123",
      }).success,
    ).toBe(false);
  });

  it("keeps JSON finite, locators structured, and binary RPC methods absent", () => {
    expect(jsonValueSchema.safeParse(Number.NaN).success).toBe(false);
    expect(jsonValueSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(
      false,
    );
    expect(jsonValueSchema.safeParse(undefined).success).toBe(false);
    expect(
      entitySummarySchema.safeParse({
        projectId: "123",
        projectVersionId: "456",
        kind: "finding",
        key: "789",
        label: "Finding 789",
        fields: { invalid: undefined },
      }).success,
    ).toBe(false);
    expect(
      rpcContract.firmwareFileGet.input.safeParse({
        projectId: "123",
        projectVersionId: "456",
        firmwarePath: "/etc/shadow",
      }).success,
    ).toBe(false);
    expect(
      validationErrorSchema.safeParse({
        code: "BAD_INPUT",
        message: "bad input",
        artifactId: "../../outside",
        line: 1,
      }).success,
    ).toBe(false);
    expect(
      documentSourceRefSchema.parse({
        documentSha256: SHA_A,
        locator: { kind: "sheet", sheet: "Parts", cell: "AA17" },
      }),
    ).toMatchObject({ locator: { kind: "sheet", cell: "AA17" } });
    expect(
      documentSourceRefSchema.safeParse({
        documentSha256: SHA_A,
        locator: { kind: "pdf", page: 0 },
      }).success,
    ).toBe(false);
    expect(
      documentSourceRefSchema.safeParse({
        documentSha256: SHA_A,
        locator: { kind: "pdf", page: 1, bbox: [0.8, 0.1, 0.2, 0.9] },
      }).success,
    ).toBe(false);
    expect(
      documentSourceRefSchema.safeParse({
        documentSha256: SHA_A,
        locator: { kind: "text", lineStart: 9, lineEnd: 3 },
      }).success,
    ).toBe(false);
    expect(
      documentSourceRefSchema.safeParse({
        documentSha256: "not-a-digest",
        locator: { kind: "text", lineStart: 1, lineEnd: 1 },
      }).success,
    ).toBe(false);
    expect(
      Object.keys(rpcContract).filter((method) =>
        /upload|export|download|stream|binary/iu.test(method),
      ),
    ).toEqual([]);
  });

  it("models independent connection failures without admitting secret fields", () => {
    const status = rpcContract.connectionsStatus.output.parse({
      platform: {
        state: "needs-configuration",
        message: "Configure Platform",
        checkedAt: null,
      },
      assuranceStudio: {
        state: "unreachable",
        message: "Probe failed",
        checkedAt: "2026-08-12T12:00:00.000Z",
      },
      forgeCompute: { state: "disabled", message: null, checkedAt: null },
    });
    expect(status.platform.state).toBe("needs-configuration");
    expect(status.assuranceStudio.state).toBe("unreachable");
    expect(status.forgeCompute.state).toBe("disabled");
    expect(
      rpcContract.connectionsStatus.output.safeParse({
        ...status,
        platform: { ...status.platform, token: "secret" },
      }).success,
    ).toBe(false);
    expect(
      rpcContract.connectionsStatus.output.safeParse({
        ...status,
        assuranceStudio: {
          ...status.assuranceStudio,
          message: "Authorization: Bearer secret",
        },
      }).success,
    ).toBe(false);
  });
});

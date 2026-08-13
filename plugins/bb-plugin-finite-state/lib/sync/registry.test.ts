import { describe, expect, it } from "vitest";

import {
  CACHE_STORAGE_NAMES,
  ENTITIES,
  InvalidEntityKeyError,
  UnknownEntityKindError,
  checkCodeKey,
  componentSlugKey,
  encodeKey,
  entryFor,
  findingStableKey,
  hbomIdKey,
  isRemotePushable,
  isSemanticPlanEntity,
  parseFindingStableKey,
  parseKey,
  referenceDesignatorKey,
  reqIdKey,
  routeSignatureKey,
  slugKey,
  sourcePathKey,
} from "./registry.js";

describe("entity registry", () => {
  it("contains the complete four-class v1 inventory with no risk entries", () => {
    expect(
      Object.fromEntries(
        Object.entries(ENTITIES).map(([kind, entry]) => [
          kind,
          "table" in entry
            ? `${entry.class}:${entry.table}`
            : "file" in entry
              ? `${entry.class}:${entry.server}:${entry.file}`
              : "dir" in entry
                ? `${entry.class}:${entry.server}:${entry.dir}`
                : "inline" in entry
                  ? `${entry.class}:${entry.server}:inline:${entry.inline}`
                  : entry.class,
        ]),
      ),
    ).toEqual({
      component: "VERSIONED:assurance-studio:product-security/architecture/components",
      zone: "VERSIONED:assurance-studio:product-security/architecture/zones",
      dataflow: "VERSIONED:assurance-studio:product-security/architecture/dataflows",
      asset: "VERSIONED:assurance-studio:product-security/architecture/assets",
      threat: "VERSIONED:assurance-studio:product-security/threats",
      mitigation: "VERSIONED:assurance-studio:product-security/mitigations",
      requirement: "VERSIONED:assurance-studio:product-security/requirements",
      hbomPart: "VERSIONED:none:product-security/hbom/hbom.yaml",
      vexDecision: "OVERLAY:platform:.fs/triage",
      reqCheckMap: "OVERLAY:assurance-studio:inline:requirement",
      checkParams: "OVERLAY:assurance-studio:.fs/verification/checks",
      attackPath: "OVERLAY:assurance-studio:.fs/attack-paths",
      sbomLink: "OVERLAY:assurance-studio:.fs/links",
      firmwareLink: "OVERLAY:none:.fs/links",
      canvasLayout: "VERSIONED:none:product-security/layout/canvas.json",
      hardwareLink: "OVERLAY:none:product-security/links",
      citationFile: "OVERLAY:none:.fs/authoring/citations",
      authoringGate: "VERSIONED:none:.fs/workflows/authoring-gate.yaml",
      finding: "CACHED:findings",
      sbomComponent: "CACHED:sbom_components",
      standardClause: "CACHED:standards_clauses",
      attackPathBody: "CACHED:attack_paths",
      verificationRun: "CACHED:verification_runs",
      verificationResult: "CACHED:verification_results",
      firmwareMount: "CACHED:firmware_mounts",
      document: "CACHED:document",
      hbomDoc: "CACHED:hbom_docs",
      hardwareProject: "CACHED:hw_project",
      hardwareArtifact: "CACHED:hw_artifact",
      hardwareSymbol: "CACHED:hw_symbol",
      hardwareNet: "CACHED:hw_net",
      hardwareViolation: "CACHED:hw_violation",
      groundingSource: "CACHED:ground_source",
      groundingChunk: "CACHED:ground_chunk",
      benchDevice: "CACHED:bench_device",
      probeRun: "CACHED:probe_run",
      buildRun: "CACHED:build_run",
      reviewTransition: "ACTION-ONLY",
      verificationDispatch: "ACTION-ONLY",
      benchDispatch: "ACTION-ONLY",
      firmwareMaterialize: "ACTION-ONLY",
    });
    expect(ENTITIES).not.toHaveProperty("risk");
    expect(ENTITIES).not.toHaveProperty("riskTreatment");
  });

  it("separates local semantic planning from remote push eligibility", () => {
    expect(ENTITIES.hbomPart).toMatchObject({ class: "VERSIONED", server: "none" });
    expect(ENTITIES.hbomPart).not.toHaveProperty("localOnly");
    expect(isSemanticPlanEntity("hbomPart")).toBe(true);
    expect(isRemotePushable("hbomPart")).toBe(false);

    expect(ENTITIES.firmwareLink).toMatchObject({ class: "OVERLAY", server: "none", localOnly: true });
    expect(ENTITIES.canvasLayout).toMatchObject({
      class: "VERSIONED",
      server: "none",
      localOnly: true,
      file: "product-security/layout/canvas.json",
    });
    expect(isSemanticPlanEntity("firmwareLink")).toBe(false);
    expect(isSemanticPlanEntity("canvasLayout")).toBe(false);
    expect(isRemotePushable("firmwareLink")).toBe(false);
    expect(isRemotePushable("canvasLayout")).toBe(false);

    expect(isRemotePushable("component")).toBe(true);
    expect(isRemotePushable("vexDecision")).toBe(true);
    expect(isSemanticPlanEntity("finding")).toBe(false);
    expect(isRemotePushable("verificationDispatch")).toBe(false);
  });

  it("keeps AMD-0012 YAML entities local-only and the push set unchanged", () => {
    expect(ENTITIES.hardwareLink).toMatchObject({
      class: "OVERLAY",
      server: "none",
      localOnly: true,
      dir: "product-security/links",
    });
    expect(ENTITIES.citationFile).toMatchObject({
      class: "OVERLAY",
      server: "none",
      localOnly: true,
      dir: ".fs/authoring/citations",
    });
    expect(ENTITIES.authoringGate).toEqual({
      class: "VERSIONED",
      server: "none",
      localOnly: true,
      file: ".fs/workflows/authoring-gate.yaml",
    });

    for (const kind of ["hardwareLink", "citationFile", "authoringGate"] as const) {
      expect(isSemanticPlanEntity(kind)).toBe(false);
      expect(isRemotePushable(kind)).toBe(false);
    }
    expect(
      Object.entries(ENTITIES).flatMap(([kind, entry]) =>
        "server" in entry && entry.server !== "none" ? [kind] : []),
    ).toEqual([
      "component", "zone", "dataflow", "asset", "threat", "mitigation",
      "requirement", "vexDecision", "reqCheckMap", "checkParams", "attackPath",
      "sbomLink",
    ]);
  });

  it("uses only declared WP-04 storage names for cached entries", () => {
    const storageNames = new Set(CACHE_STORAGE_NAMES);
    for (const entry of Object.values(ENTITIES)) {
      if (entry.class === "CACHED") {
        expect(storageNames.has(entry.table)).toBe(true);
      }
    }
    expect(ENTITIES.hbomDoc).toMatchObject({ table: "hbom_docs", storageKind: "view" });
  });

  it("encodes all ordinary keys as reversible fs1 dot-delimited base64url segments", () => {
    const keys = [
      slugKey({ slug: "Caf\u0065\u0301" }),
      reqIdKey({ reqId: "REQ-42" }),
      hbomIdKey({ id: "U17" }),
      checkCodeKey({ code: "MISRA-C-1" }),
      componentSlugKey({ componentSlug: "gateway" }),
      referenceDesignatorKey({ reference: "U3" }),
      sourcePathKey({ file: "src/drivers/bme280.c" }),
      routeSignatureKey({ routeSignature: "gateway-to-cloud" }),
    ];

    expect(keys[0]).toBe(slugKey({ slug: "Café" }));
    for (const key of keys) {
      expect(key).toMatch(/^fs1(?:\.[A-Za-z0-9_-]+)+$/u);
      expect(parseKey(key).length).toBeGreaterThan(1);
    }
    expect(parseKey(encodeKey("entity", "value"))).toEqual(["entity", "value"]);
  });

  it("uses the finding key ladder without serializing project scope or finding UUID", () => {
    const purlFinding = {
      cve: "CVE-2026-1234",
      purl: "pkg:npm/%40scope/pkg@1.2.3",
      name: "Ignored when purl exists",
      group: "ignored",
      version: "ignored",
      findingId: "server-uuid-a",
    };
    const sameFindingNewUuid = { ...purlFinding, findingId: "server-uuid-b" };
    const purlKey = findingStableKey(purlFinding);
    expect(purlKey).toBe(findingStableKey(sameFindingNewUuid));
    expect(purlKey).toBe(findingStableKey({
      ...purlFinding,
      projectId: "project-a",
      projectVersionId: "version-a",
    }));
    expect(purlKey).toBe(findingStableKey({
      ...purlFinding,
      projectId: "project-b",
      projectVersionId: "version-b",
    }));
    expect(parseFindingStableKey(purlKey)).toEqual({
      cve: "CVE-2026-1234",
      tier: "purl",
      component: { purl: "pkg:npm/%40scope/pkg@1.2.3" },
    });

    const exact = findingStableKey({ cve: "CVE-2026-1234", name: "OpenSSL", group: "Core", version: "3.0.0" });
    const exactCaseVariant = findingStableKey({ cve: "CVE-2026-1234", name: "openssl", group: "core", version: "3.0.0" });
    const anyVersion = findingStableKey({ cve: "CVE-2026-1234", name: "OpenSSL", group: "Core" });
    expect(exact).toBe(exactCaseVariant);
    expect(anyVersion).not.toBe(exact);
    expect(parseFindingStableKey(anyVersion)).toEqual({
      cve: "CVE-2026-1234",
      tier: "name-group-any-version",
      component: { name: "openssl", group: "core", version: null },
    });
  });

  it("fails closed for malformed and unsafe identities", () => {
    expect(() => slugKey({ slug: "../escape" })).toThrow(InvalidEntityKeyError);
    expect(() => reqIdKey({ reqId: "\u0000" })).toThrow(InvalidEntityKeyError);
    expect(() => findingStableKey({ cve: "", name: "component" })).toThrow(InvalidEntityKeyError);
    expect(() => findingStableKey({ cve: "CVE-2026-1234", name: "component" }, "purl")).toThrow(InvalidEntityKeyError);
    expect(() => parseKey("fs1.not+base64")).toThrow(InvalidEntityKeyError);
    expect(() => parseKey(`fs1.${Buffer.from("Cafe\u0301", "utf8").toString("base64url")}`)).toThrow(InvalidEntityKeyError);
    expect(() => parseFindingStableKey(encodeKey("component", "gateway"))).toThrow(InvalidEntityKeyError);
  });

  it("throws a typed error for unknown runtime entity names", () => {
    expect(() => entryFor("not-an-entity")).toThrow(UnknownEntityKindError);
    expect(entryFor("hbomPart")).toBe(ENTITIES.hbomPart);
  });
});

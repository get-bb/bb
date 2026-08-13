import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface MockPlatformState {
  readonly projects: Map<string, Record<string, unknown>>;
  readonly versions: Map<string, Record<string, unknown>>;
  readonly findings: Map<string, Record<string, unknown>>;
  readonly findingActivity: Map<string, Record<string, unknown>[]>;
  readonly findingComments: Map<string, Map<string, Record<string, unknown>>>;
  readonly components: Map<string, Record<string, unknown>>;
  vexTuple(pvId: string, findingId: string): {
    status: string | null;
    response: string | null;
    justification: string | null;
    reason: string | null;
  } | null;
  snapshot(): unknown;
  reset(): void;
}

export class MockPlatformFixtureError extends Error {
  readonly code = "MOCK_PLATFORM_FIXTURE_INVALID";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MockPlatformFixtureError";
  }
}

interface PlatformBacking {
  readonly sbomBytes: Uint8Array;
  readonly spdxBytes: Uint8Array;
  readonly vexFailures: ReadonlyMap<string, string>;
}

const backingByState = new WeakMap<MockPlatformState, PlatformBacking>();

function object(value: unknown, source: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new MockPlatformFixtureError(`${source} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string, source: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new MockPlatformFixtureError(`${source} must contain a non-empty ${key}`);
  }
  return value;
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(record);
}

function parseJson(bytes: Uint8Array, source: string): Record<string, unknown> {
  try {
    return object(JSON.parse(Buffer.from(bytes).toString("utf8")), source);
  } catch (error: unknown) {
    if (error instanceof MockPlatformFixtureError) throw error;
    throw new MockPlatformFixtureError(`${source} is not valid JSON`, { cause: error });
  }
}

function parseJsonLines(bytes: Uint8Array, source: string): Record<string, unknown>[] {
  const text = Buffer.from(bytes).toString("utf8");
  try {
    return text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line, index) => object(JSON.parse(line), `${source}:${index + 1}`));
  } catch (error: unknown) {
    if (error instanceof MockPlatformFixtureError) throw error;
    throw new MockPlatformFixtureError(`${source} is not valid JSONL`, { cause: error });
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readRequired(root: string, relativePath: string): Uint8Array {
  try {
    return readFileSync(resolve(root, ...relativePath.split("/")));
  } catch (error: unknown) {
    throw new MockPlatformFixtureError(`Required fixture is unavailable: ${relativePath}`, {
      cause: error,
    });
  }
}

function validateManifestFile(
  manifest: Record<string, unknown>,
  relativePath: string,
  bytes: Uint8Array,
): void {
  const files = manifest.files;
  if (!Array.isArray(files)) {
    throw new MockPlatformFixtureError("manifest.json has no files collection");
  }
  const entry = files.find((candidate: unknown) => {
    return candidate !== null && typeof candidate === "object" &&
      (candidate as Record<string, unknown>).path === relativePath;
  });
  const record = object(entry, `manifest entry for ${relativePath}`);
  if (record.bytes !== bytes.byteLength || record.sha256 !== sha256(bytes)) {
    throw new MockPlatformFixtureError(`Fixture content does not match manifest: ${relativePath}`);
  }
}

function replaceMap<K, V>(target: Map<K, V>, source: ReadonlyMap<K, V>, clone: (value: V) => V): void {
  target.clear();
  for (const [key, value] of source) target.set(key, clone(value));
}

function jsonSnapshot(map: ReadonlyMap<string, Record<string, unknown>>): unknown[] {
  return [...map.entries()].map(([key, value]) => [key, cloneRecord(value)]);
}

export function platformSbom(state: MockPlatformState): PlatformBacking {
  const backing = backingByState.get(state);
  if (backing === undefined) throw new Error("Mock Platform state has no SBOM backing");
  return backing;
}

export function platformVexFailure(state: MockPlatformState, findingId: string): string | null {
  return backingByState.get(state)?.vexFailures.get(findingId) ?? null;
}

export function createMockPlatformState(fixtureRoot: string): MockPlatformState {
  const required = [
    "platform/identity.json",
    "platform/findings.jsonl",
    "platform/finding-detail.json",
    "platform/findings-summary.json",
    "platform/components.jsonl",
    "platform/sbom.cdx.json",
    "platform/vex-bulk-partial.json",
    "expected/finding-history.json",
  ] as const;
  const manifestBytes = readRequired(fixtureRoot, "manifest.json");
  const manifest = parseJson(manifestBytes, "manifest.json");
  const bytesByPath = new Map(required.map((path) => [path, readRequired(fixtureRoot, path)]));
  for (const [path, bytes] of bytesByPath) validateManifestFile(manifest, path, bytes);

  const identity = parseJson(bytesByPath.get("platform/identity.json")!, "platform/identity.json");
  const project = object(identity.project, "platform/identity.json project");
  const versionValues = identity.versions;
  if (!Array.isArray(versionValues)) {
    throw new MockPlatformFixtureError("platform/identity.json must contain versions");
  }
  const findingRows = parseJsonLines(bytesByPath.get("platform/findings.jsonl")!, "platform/findings.jsonl");
  const detail = parseJson(bytesByPath.get("platform/finding-detail.json")!, "platform/finding-detail.json");
  const history = parseJson(bytesByPath.get("expected/finding-history.json")!, "expected/finding-history.json");
  const componentRows = parseJsonLines(bytesByPath.get("platform/components.jsonl")!, "platform/components.jsonl");
  const sbomBytes = bytesByPath.get("platform/sbom.cdx.json")!;
  const sbom = parseJson(sbomBytes, "platform/sbom.cdx.json");
  const vexPartial = parseJson(
    bytesByPath.get("platform/vex-bulk-partial.json")!,
    "platform/vex-bulk-partial.json",
  );

  const initialProjects = new Map([[stringField(project, "id", "project"), cloneRecord(project)]]);
  const initialVersions = new Map<string, Record<string, unknown>>();
  for (const value of versionValues) {
    const version = object(value, "platform version");
    const id = stringField(version, "id", "platform version");
    if (initialVersions.has(id)) throw new MockPlatformFixtureError(`Duplicate version id: ${id}`);
    initialVersions.set(id, cloneRecord(version));
  }

  // Occurrence keys deliberately retain physical duplicate UUID rows from the frozen corpus.
  const initialFindings = new Map<string, Record<string, unknown>>();
  const findingOccurrences = new Map<string, number>();
  findingRows.forEach((finding, index) => {
    const id = stringField(finding, "id", `finding row ${index + 1}`);
    const projectVersionId = stringField(finding, "projectVersionId", `finding row ${index + 1}`);
    if (!initialVersions.has(projectVersionId)) {
      throw new MockPlatformFixtureError(`Finding ${id} references unknown version ${projectVersionId}`);
    }
    const occurrence = (findingOccurrences.get(id) ?? 0) + 1;
    findingOccurrences.set(id, occurrence);
    initialFindings.set(occurrence === 1 ? id : `${id}#${occurrence}`, cloneRecord(finding));
  });
  const detailPvId = stringField(detail, "projectVersionId", "finding detail");
  const detailFindingId = stringField(detail, "id", "finding detail");
  const detailFinding = [...initialFindings.values()].find(
    (finding) => finding.projectVersionId === detailPvId && finding.id === detailFindingId,
  );
  if (detailFinding === undefined) {
    throw new MockPlatformFixtureError("Finding detail does not resolve to a canonical finding");
  }
  for (const [key, value] of Object.entries(detail)) {
    if (key !== "comments") detailFinding[key] = structuredClone(value);
  }

  const initialComponents = new Map<string, Record<string, unknown>>();
  componentRows.forEach((component, index) => {
    const id = stringField(component, "id", "platform component");
    if (initialComponents.has(id)) throw new MockPlatformFixtureError(`Duplicate component id: ${id}`);
    initialComponents.set(id, {
      ...cloneRecord(component),
      // The frozen corpus has no override/exclusion columns. Preserve its one
      // version-change case as edited and one deterministic tail row as excluded.
      edited: component.priorVersion !== component.version,
      excluded: index === componentRows.length - 1,
    });
  });
  for (const finding of initialFindings.values()) {
    const componentId = stringField(finding, "componentId", "platform finding");
    if (!initialComponents.has(componentId)) {
      throw new MockPlatformFixtureError(`Finding references unknown component ${componentId}`);
    }
  }
  if (!Array.isArray(sbom.components)) {
    throw new MockPlatformFixtureError("platform/sbom.cdx.json must contain components");
  }
  for (const value of sbom.components) {
    const component = object(value, "SBOM component");
    const id = stringField(component, "bom-ref", "SBOM component");
    if (!initialComponents.has(id)) {
      throw new MockPlatformFixtureError(`SBOM references unknown component ${id}`);
    }
  }
  if (!Array.isArray(vexPartial.results)) {
    throw new MockPlatformFixtureError("platform/vex-bulk-partial.json must contain results");
  }
  const vexFailures = new Map<string, string>();
  for (const value of vexPartial.results) {
    const result = object(value, "bulk VEX fixture result");
    const findingId = stringField(result, "findingId", "bulk VEX fixture result");
    if (![...initialFindings.values()].some((finding) => finding.id === findingId)) {
      throw new MockPlatformFixtureError(`Bulk VEX fixture references unknown finding ${findingId}`);
    }
    if (result.success === false && typeof result.error === "string") {
      vexFailures.set(findingId, result.error);
    }
  }

  const initialComments = new Map<string, Map<string, Record<string, unknown>>>();
  if (!initialVersions.has(detailPvId)) {
    throw new MockPlatformFixtureError(`Finding detail references unknown version ${detailPvId}`);
  }
  const comments = detail.comments;
  if (!Array.isArray(comments)) throw new MockPlatformFixtureError("finding detail comments must be an array");
  const commentMap = new Map<string, Record<string, unknown>>();
  for (const value of comments) {
    const comment = object(value, "finding comment");
    const id = stringField(comment, "id", "finding comment");
    commentMap.set(id, { ...cloneRecord(comment), findingId: detailFindingId });
  }
  initialComments.set(detailPvId, commentMap);

  const projectId = stringField(project, "id", "project");
  const historyFindingId = stringField(history, "findingId", "finding history");
  const historyFinding = [...initialFindings.values()].find((finding) => finding.id === historyFindingId);
  if (historyFinding === undefined || !Array.isArray(history.events)) {
    throw new MockPlatformFixtureError("finding history does not resolve to a canonical finding");
  }
  const activityKey = `${projectId}:${String(historyFinding.cve)}`;
  const initialActivity = new Map([[activityKey, history.events.map((event) => ({
    ...cloneRecord(object(event, "finding history event")),
    findingId: historyFindingId,
    projectVersionId: historyFinding.projectVersionId,
    cve: historyFinding.cve,
  }))]]);

  const projects = new Map<string, Record<string, unknown>>();
  const versions = new Map<string, Record<string, unknown>>();
  const findings = new Map<string, Record<string, unknown>>();
  const findingActivity = new Map<string, Record<string, unknown>[]>();
  const findingComments = new Map<string, Map<string, Record<string, unknown>>>();
  const components = new Map<string, Record<string, unknown>>();
  const spdxBytes = Buffer.from(`${JSON.stringify({
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "Eagle Connected Gateway 2.4.0",
    documentNamespace: `https://finite-state.example/sbom/${detailPvId}`,
    creationInfo: { created: "2026-05-12T14:30:00.000Z", creators: ["Tool: Finite State mock"] },
    packages: componentRows.map((component) => ({
      SPDXID: `SPDXRef-${String(component.id)}`,
      name: component.name,
      versionInfo: component.version,
      externalRefs: component.purl === null ? [] : [{
        referenceCategory: "PACKAGE-MANAGER",
        referenceType: "purl",
        referenceLocator: component.purl,
      }],
    })),
  }, null, 2)}\n`, "utf8");

  const state: MockPlatformState = {
    projects,
    versions,
    findings,
    findingActivity,
    findingComments,
    components,
    vexTuple(pvId, findingId) {
      const finding = [...findings.values()].find(
        (candidate) => candidate.projectVersionId === pvId && candidate.id === findingId,
      );
      if (finding === undefined) return null;
      return {
        status: typeof finding.vexStatus === "string" ? finding.vexStatus : null,
        response: typeof finding.vexResponse === "string" ? finding.vexResponse : null,
        justification: typeof finding.vexJustification === "string" ? finding.vexJustification : null,
        reason: typeof finding.vexReason === "string" ? finding.vexReason : null,
      };
    },
    snapshot() {
      return {
        projects: jsonSnapshot(projects),
        versions: jsonSnapshot(versions),
        findings: jsonSnapshot(findings),
        findingActivity: [...findingActivity.entries()].map(([key, values]) => [key, structuredClone(values)]),
        findingComments: [...findingComments.entries()].map(([pvId, values]) => [pvId, jsonSnapshot(values)]),
        components: jsonSnapshot(components),
        sbomSha256: sha256(sbomBytes),
        spdxSha256: sha256(spdxBytes),
      };
    },
    reset() {
      replaceMap(projects, initialProjects, cloneRecord);
      replaceMap(versions, initialVersions, cloneRecord);
      replaceMap(findings, initialFindings, cloneRecord);
      replaceMap(components, initialComponents, cloneRecord);
      findingActivity.clear();
      for (const [key, values] of initialActivity) findingActivity.set(key, structuredClone(values));
      findingComments.clear();
      for (const [pvId, values] of initialComments) {
        findingComments.set(pvId, new Map([...values].map(([key, value]) => [key, cloneRecord(value)])));
      }
    },
  };
  state.reset();
  backingByState.set(state, {
    sbomBytes: Uint8Array.from(sbomBytes),
    spdxBytes: Uint8Array.from(spdxBytes),
    vexFailures,
  });
  return state;
}

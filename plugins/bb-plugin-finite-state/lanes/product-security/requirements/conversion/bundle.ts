import { createHash, randomUUID } from "node:crypto";

const PAGE_SIZE = 20;
const MAX_REQUIREMENTS = 500;
const MAX_SNAPSHOT_REQUIREMENTS = 10_000;
const MAX_SUMMARIES_PER_CHECK = 20;

export interface EarsConversionBundleMeta {
  bundleId: string;
  projectId: string;
  pulledAt: string;
  snapshotDigest: string;
  requirementIds: string[];
}

export interface ConversionCheckSource {
  id: string;
  slug: string;
  method: string;
  tier: "static" | "emulation" | "hil" | "manual";
  required: boolean;
  coverage: "full" | "partial" | "none" | null;
  suppressed: boolean;
  description: string | null;
  passCriteria: string;
  failCriteria: string | null;
  resultSummaries: Array<{
    status: string;
    summary: string | null;
    executedAt: string | null;
  }>;
}

export interface ConversionSource {
  requirementId: string;
  remoteId: string;
  targetPath: string;
  sourceDescription: string;
  reqType: "security" | "privacy" | "safety" | "regulatory" | "operational";
  priority: string;
  status: "draft" | "approved" | "implemented" | "verified";
  rationale: string | null;
  traces: {
    mitigations: string[];
    controls: string[];
    standards: string[];
  };
  checks: ConversionCheckSource[];
  sourceDigest: string;
}

export interface ConversionReferenceIndex {
  requirements: ReadonlyMap<string, string>;
  checks: ReadonlyMap<string, string>;
  mitigations: ReadonlyMap<string, string>;
  controls: ReadonlyMap<string, string>;
  standards: ReadonlyMap<string, string>;
}

export interface ConversionPullSnapshot {
  projectId: string;
  pulledAt: string;
  requirements: ConversionSource[];
  references: ConversionReferenceIndex;
}

export interface ConversionDeps {
  projectId: string;
  projectVersionId: string | null;
  loadPullSnapshot(): Promise<ConversionPullSnapshot | null>;
  readLocalFile(path: string): Promise<string | null>;
  spawnOriginPluginThread(input: {
    projectId: string;
    title: string;
    prompt: string;
  }): Promise<{ threadId: string }>;
  now?(): Date;
  randomId?(): string;
}

export interface StoredConversionBundle {
  meta: EarsConversionBundleMeta;
  sources: ConversionSource[];
  references: ConversionReferenceIndex;
  deps: ConversionDeps;
}

const bundles = new Map<string, StoredConversionBundle>();

function stableDigest(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function contractValue(source: ConversionSource) {
  return {
    requirementId: source.requirementId,
    remoteId: source.remoteId,
    sourceDescription: source.sourceDescription,
    reqType: source.reqType,
    priority: source.priority,
    status: source.status,
    rationale: source.rationale,
    traces: source.traces,
    checks: source.checks.map((check) => ({
      id: check.id,
      slug: check.slug,
      method: check.method,
      tier: check.tier,
      required: check.required,
      coverage: check.coverage,
      suppressed: check.suppressed,
      description: check.description,
      passCriteria: check.passCriteria,
      failCriteria: check.failCriteria,
    })),
  };
}

export function conversionSourceDigest(source: ConversionSource): string {
  return stableDigest(contractValue(source));
}

export function conversionSnapshotDigest(sources: readonly ConversionSource[]): string {
  return stableDigest(
    [...sources]
      .sort((left, right) => left.requirementId.localeCompare(right.requirementId))
      .map(contractValue),
  );
}

function boundedSource(source: ConversionSource): ConversionSource {
  return {
    ...source,
    traces: {
      mitigations: [...source.traces.mitigations],
      controls: [...source.traces.controls],
      standards: [...source.traces.standards],
    },
    checks: source.checks.map((check) => ({
      ...check,
      resultSummaries: check.resultSummaries.slice(0, MAX_SUMMARIES_PER_CHECK),
    })),
    sourceDigest: conversionSourceDigest(source),
  };
}

export async function buildConversionBundle(
  deps: ConversionDeps,
  reqIds?: string[],
): Promise<EarsConversionBundleMeta> {
  const snapshot = await deps.loadPullSnapshot();
  if (!snapshot) throw new Error("No accepted pull snapshot is available for conversion.");
  if (snapshot.projectId !== deps.projectId) throw new Error("The pull snapshot belongs to another project.");
  if (snapshot.requirements.length > MAX_SNAPSHOT_REQUIREMENTS) {
    throw new Error("The accepted requirement snapshot exceeds the 10,000-item safety bound.");
  }
  const requirementIds = snapshot.requirements.map((source) => source.requirementId);
  if (requirementIds.length !== new Set(requirementIds).size) {
    throw new Error("The accepted pull snapshot contains duplicate requirement ids.");
  }
  const checks = snapshot.requirements.flatMap((source) => source.checks);
  const idBySlug = new Map<string, string>();
  const slugById = new Map<string, string>();
  const conflictingCheck = checks.some((check) => {
    const conflict = (idBySlug.has(check.slug) && idBySlug.get(check.slug) !== check.id)
      || (slugById.has(check.id) && slugById.get(check.id) !== check.slug);
    idBySlug.set(check.slug, check.id);
    slugById.set(check.id, check.slug);
    return conflict;
  });
  if (conflictingCheck) {
    throw new Error("The accepted pull snapshot contains duplicate verification check identities.");
  }

  const requested = reqIds === undefined
    ? requirementIds
    : [...new Set(reqIds)];
  if (requested.length > MAX_REQUIREMENTS) throw new Error("A conversion may contain at most 500 requirements.");
  const byId = new Map(snapshot.requirements.map((source) => [source.requirementId, source]));
  const unknown = requested.filter((id) => !byId.has(id));
  if (unknown.length > 0) throw new Error(`Unknown cached requirement ids: ${unknown.slice(0, 10).join(", ")}.`);

  const sources = requested.map((id) => {
    const source = byId.get(id);
    if (!source) throw new Error(`Unknown cached requirement id: ${id}.`);
    return boundedSource(source);
  });
  const meta: EarsConversionBundleMeta = {
    bundleId: `ears-${deps.randomId?.() ?? randomUUID()}`,
    projectId: deps.projectId,
    pulledAt: snapshot.pulledAt,
    snapshotDigest: conversionSnapshotDigest(sources),
    requirementIds: sources.map((source) => source.requirementId),
  };
  bundles.set(meta.bundleId, { meta, sources, references: snapshot.references, deps });
  return meta;
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid conversion bundle cursor.");
  return offset;
}

export async function getConversionBundlePage(
  bundleId: string,
  cursor?: string,
): Promise<{ items: ConversionSource[]; nextCursor: string | null }> {
  const bundle = bundles.get(bundleId);
  if (!bundle) throw new Error("Conversion bundle was not found or has expired.");
  const offset = parseCursor(cursor);
  const items = bundle.sources.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + items.length;
  return {
    items,
    nextCursor: nextOffset < bundle.sources.length ? String(nextOffset) : null,
  };
}

export function getStoredConversionBundle(bundleId: string): StoredConversionBundle {
  const bundle = bundles.get(bundleId);
  if (!bundle) throw new Error("Conversion bundle was not found or has expired.");
  return bundle;
}

export function findBundleForPaths(paths: readonly string[]): StoredConversionBundle {
  const pathSet = new Set(paths);
  const candidates = [...bundles.values()].filter((bundle) => {
    const owned = new Set(bundle.sources.map((source) => source.targetPath));
    return [...pathSet].every((path) => owned.has(path));
  });
  const bundle = candidates.at(-1);
  if (!bundle) throw new Error("No conversion bundle owns the requested requirement paths.");
  return bundle;
}

export function clearConversionBundlesForTests(): void {
  bundles.clear();
}

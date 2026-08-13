import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import type { Json, PlatformClient } from "../../../lib/remote/types.js";
import { ENTITIES } from "../../../lib/sync/registry.js";
import { createSerializer } from "../serialize/serializer.js";
import { SerializeError } from "../serialize/yaml.js";
import type {
  EntityAdapter,
  KeyResolver,
  ServerEntity,
  WorkingEntity,
} from "../engine/adapter.js";
import type { BaseRow } from "../store/base-snapshot.js";
import { emitYaml } from "../serialize/yaml.js";

const VEX_FIELDS = ["status", "justification", "response", "reason"] as const;
const PAGE_SIZE = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(
  row: Readonly<Record<string, Json>>,
  field: string,
): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Platform finding is missing ${field}`);
  }
  return value;
}

function optionalString(
  row: Readonly<Record<string, Json>>,
  field: string,
): string | null {
  const value = row[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new TypeError(`Platform finding ${field} must be a string or null`);
  return value;
}

function purlIdentity(purl: string | null): {
  name: string;
  group: string | null;
  version: string | null;
} | null {
  if (purl === null || !purl.startsWith("pkg:")) return null;
  const withoutSuffix = purl.slice(4).split(/[?#]/u, 1)[0] ?? "";
  const slash = withoutSuffix.indexOf("/");
  if (slash < 0) return null;
  const segments = withoutSuffix.slice(slash + 1).split("/");
  const last = segments.pop();
  if (last === undefined || last.length === 0) return null;
  const at = last.lastIndexOf("@");
  const encodedName = at < 0 ? last : last.slice(0, at);
  const encodedVersion = at < 0 ? null : last.slice(at + 1);
  try {
    return {
      name: decodeURIComponent(encodedName),
      group: segments.length === 0 ? null : segments.map(decodeURIComponent).join("/"),
      version: encodedVersion === null || encodedVersion.length === 0
        ? null
        : decodeURIComponent(encodedVersion),
    };
  } catch {
    return null;
  }
}

function vexPayload(row: Readonly<Record<string, Json>>): Record<string, unknown> | null {
  const tuple = {
    status: optionalString(row, "vexStatus"),
    justification: optionalString(row, "vexJustification"),
    response: optionalString(row, "vexResponse"),
    reason: optionalString(row, "vexReason"),
  };
  return Object.values(tuple).every((value) => value === null) ? null : tuple;
}

function findingIdentity(row: Readonly<Record<string, Json>>) {
  const purl = optionalString(row, "componentPurl");
  const parsed = purlIdentity(purl);
  const fallback = optionalString(row, "componentFallbackIdentity")
    ?? requiredString(row, "componentId");
  return {
    cve: requiredString(row, "cve"),
    purl,
    name: parsed?.name ?? fallback,
    group: parsed?.group ?? null,
    version: parsed?.version ?? null,
  };
}

/** Computes the frozen exact canonical key for any normalized Platform finding. */
export function projectVexDecisionKey(row: Readonly<Record<string, Json>>): string {
  return ENTITIES.vexDecision.key(findingIdentity(row));
}

/** Projects one normalized Platform finding into the frozen VEX overlay shape. */
export function projectVexDecision(
  row: Readonly<Record<string, Json>>,
): ServerEntity | null {
  const payload = vexPayload(row);
  if (payload === null) return null;
  return {
    key: projectVexDecisionKey(row),
    remoteId: requiredString(row, "id"),
    payload,
  };
}

/**
 * Creates WP-17's exact-key orphan resolver over the complete finding corpus,
 * including findings that do not currently carry a VEX tuple.
 */
export function createVexDecisionResolver(client: PlatformClient): KeyResolver {
  const pending = new Map<string, Promise<ReadonlySet<string>>>();
  const serverKeys = (projectId: string, projectVersionId: string): Promise<ReadonlySet<string>> => {
    const scopeKey = `${projectId}\0${projectVersionId}`;
    const current = pending.get(scopeKey);
    if (current !== undefined) return current;
    const next = (async () => {
      const keys = new Set<string>();
      for await (const page of client.getFindings({
        projectVersionId,
        page: { pageSize: PAGE_SIZE },
      })) {
        for (const row of page.items) keys.add(projectVexDecisionKey(row));
      }
      return keys;
    })();
    pending.set(scopeKey, next);
    void next.then(
      () => setTimeout(() => pending.delete(scopeKey), 0),
      () => setTimeout(() => pending.delete(scopeKey), 0),
    );
    return next;
  };
  return async (key, scope) => {
    if (scope.projectVersionId === null) return { resolved: false };
    return (await serverKeys(scope.projectId, scope.projectVersionId)).has(key)
      ? { resolved: true, detail: { match: "exact" } }
      : { resolved: false };
  };
}

function normalizedFile(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

async function yamlFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await yamlFiles(path));
    if (
      entry.isFile()
      && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
      && entry.name !== "policy.yaml"
    ) {
      files.push(path);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function stringOrNull(value: unknown, field: string, file: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new SerializeError(file, 1, `${field} must be a string or null`);
  return value;
}

function componentIdentity(
  raw: Record<string, unknown>,
  file: string,
): { purl: string | null; name: string; group: string | null; version: string | null } {
  const purl = stringOrNull(raw["purl"], "component.purl", file);
  const parsed = purlIdentity(purl);
  const name = raw["name"];
  if (typeof name !== "string" && parsed === null) {
    throw new SerializeError(file, 1, "component.name is required when component.purl cannot provide it");
  }
  return {
    purl,
    name: typeof name === "string" ? name : parsed?.name ?? "",
    group: stringOrNull(raw["group"], "component.group", file) ?? parsed?.group ?? null,
    version: stringOrNull(raw["version"], "component.version", file) ?? parsed?.version ?? null,
  };
}

function decisionPayload(raw: Record<string, unknown>, file: string): Record<string, unknown> {
  return Object.fromEntries(VEX_FIELDS.map((field) => [
    field,
    stringOrNull(raw[field], `decision.${field}`, file),
  ]));
}

function aggregateDecisions(
  document: Record<string, unknown>,
  file: string,
): Array<{ cve: string; identity: ReturnType<typeof componentIdentity>; payload: Record<string, unknown> }> {
  if (!isRecord(document["component"]) || !isRecord(document["decisions"])) {
    return [];
  }
  const identity = componentIdentity(document["component"], file);
  const result = [];
  for (const [cve, value] of Object.entries(document["decisions"])) {
    if (!isRecord(value)) throw new SerializeError(file, 1, `decision ${cve} must be a mapping`);
    result.push({ cve, identity, payload: decisionPayload(value, file) });
  }
  return result;
}

function singleDecision(
  document: Record<string, unknown>,
  file: string,
): Array<{ cve: string; identity: ReturnType<typeof componentIdentity>; payload: Record<string, unknown> }> {
  if (typeof document["cve"] !== "string") return [];
  return [{
    cve: document["cve"],
    identity: componentIdentity(document, file),
    payload: decisionPayload(document, file),
  }];
}

/**
 * A typed parse failure that preserves entities from every valid triage file.
 * Engines surface `issues` while continuing with `partialWorking`.
 */
export class VexWorkingReadError extends SerializeError {
  readonly issues: readonly SerializeError[];
  readonly partialWorking: readonly WorkingEntity[];

  constructor(issues: readonly SerializeError[], partialWorking: readonly WorkingEntity[]) {
    const first = issues[0];
    if (first === undefined) throw new TypeError("VexWorkingReadError requires at least one issue");
    super(
      first.file,
      first.line,
      `${issues.length} triage file${issues.length === 1 ? "" : "s"} could not be parsed`,
      { cause: first },
    );
    this.issues = [...issues];
    this.partialWorking = [...partialWorking];
  }
}

/** Reads all `.fs/triage` decision YAML beneath a worktree. */
export async function readVexWorking(worktreeRoot: string): Promise<WorkingEntity[]> {
  const root = resolve(worktreeRoot);
  const serializer = createSerializer("vexDecision");
  const result: WorkingEntity[] = [];
  const keys = new Map<string, string>();
  const issues: SerializeError[] = [];
  for (const absoluteFile of await yamlFiles(join(root, ".fs", "triage"))) {
    const file = normalizedFile(root, absoluteFile);
    try {
      const document = serializer.fromYaml(await readFile(absoluteFile, "utf8"), file);
      const aggregate = aggregateDecisions(document, file);
      const decisions = aggregate.length > 0 ? aggregate : singleDecision(document, file);
      const project = typeof document["project"] === "string" ? document["project"] : "";
      if (decisions.length === 0) {
        throw new SerializeError(file, 1, `${basename(file)} is not an fs-triage decision document`);
      }
      const fileRows: WorkingEntity[] = [];
      const fileKeys = new Set<string>();
      for (const decision of decisions) {
        const key = ENTITIES.vexDecision.key({ cve: decision.cve, ...decision.identity });
        const scopedKey = `${project}\0${key}`;
        const prior = keys.get(scopedKey);
        if (prior !== undefined || fileKeys.has(scopedKey)) {
          throw new SerializeError(file, 1, `decision key is already authored in ${prior ?? file}`);
        }
        fileKeys.add(scopedKey);
        fileRows.push({ key, payload: decision.payload, file });
      }
      for (const row of fileRows) {
        keys.set(`${project}\0${row.key}`, file);
        result.push(row);
      }
    } catch (error: unknown) {
      if (!(error instanceof SerializeError)) throw error;
      issues.push(error);
    }
  }
  result.sort((left, right) => left.key.localeCompare(right.key));
  if (issues.length > 0) throw new VexWorkingReadError(issues, result);
  return result;
}

function syncBlock(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const metadata = await stat(file);
    await writeFile(temporary, contents, { encoding: "utf8", mode: metadata.mode });
    await rename(temporary, file);
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Rewrites only `sync.base` for git-clean VEX artifacts after the accepted
 * generation publishes. Authored tuple/provenance/pin fields are preserved.
 */
export async function fastForwardVexWorking(
  worktreeRoot: string,
  files: readonly string[],
  baseRows: readonly BaseRow[],
): Promise<void> {
  const root = resolve(worktreeRoot);
  const base = new Map(baseRows.map((row) => [row.entityKey, row.payload]));
  const serializer = createSerializer("vexDecision");
  for (const file of files) {
    const absoluteFile = resolve(root, ...file.split("/"));
    if (absoluteFile !== root && !absoluteFile.startsWith(`${root}${sep}`)) {
      throw new SerializeError(file, null, "triage file escapes the worktree");
    }
    const document = serializer.fromYaml(await readFile(absoluteFile, "utf8"), file);
    let changed = false;
    if (isRecord(document["component"]) && isRecord(document["decisions"])) {
      const identity = componentIdentity(document["component"], file);
      for (const [cve, decision] of Object.entries(document["decisions"])) {
        if (!isRecord(decision)) continue;
        const key = ENTITIES.vexDecision.key({ cve, ...identity });
        const payload = base.get(key);
        if (payload === undefined) continue;
        decision["sync"] = { ...syncBlock(decision["sync"]), base: { ...payload } };
        changed = true;
      }
    } else if (typeof document["cve"] === "string") {
      const identity = componentIdentity(document, file);
      const key = ENTITIES.vexDecision.key({ cve: document["cve"], ...identity });
      const payload = base.get(key);
      if (payload !== undefined) {
        document["sync"] = { ...syncBlock(document["sync"]), base: { ...payload } };
        changed = true;
      }
    }
    if (changed) await atomicWrite(absoluteFile, emitYaml(document));
  }
}

/** Creates the VEX adapter while closing over only its owning Platform client. */
export function createVexDecisionAdapter(client: PlatformClient): EntityAdapter {
  return {
    kind: "vexDecision",
    klass: "OVERLAY",
    serializer: createSerializer("vexDecision"),
    async *fetchRemote(scope, onProgress) {
      if (scope.projectVersionId === null) {
        throw new TypeError("vexDecision requires a project version");
      }
      let pageNumber = 0;
      const pages = client.getFindings({
        projectVersionId: scope.projectVersionId,
        page: { pageSize: PAGE_SIZE },
      });
      for await (const page of pages) {
        pageNumber += 1;
        onProgress({
          page: pageNumber,
          of: page.total === null ? null : Math.ceil(page.total / PAGE_SIZE),
        });
        yield page.items.flatMap((row) => {
          const projected = projectVexDecision(row);
          return projected === null ? [] : [projected];
        });
      }
    },
    readWorking: readVexWorking,
  };
}

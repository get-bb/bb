import { randomUUID } from "node:crypto";
import {
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import type { Json, PlatformClient } from "../../../lib/remote/types.js";
import type Database from "better-sqlite3";
import { stripVexProvenance } from "../../findings/bulk/readback.js";
import {
  canonicalFindingStableKey,
  canonicalizeFindingIdentity,
  legacyFindingStableKey,
  selectFindingCve,
  type CanonicalFindingIdentity,
  type FindingIdentityInput,
} from "../../findings/stable-key/canonical.js";
import {
  currentFindingIdentity,
  purlIdentity,
} from "../../findings/stable-key/wire-identity.js";
import { createSerializer } from "../serialize/serializer.js";
import { SerializeError } from "../serialize/yaml.js";
import type {
  EntityAdapter,
  KeyResolver,
  ServerEntity,
  SyncScope,
  WorkingEntity,
} from "../engine/adapter.js";
import type { BaseRow } from "../store/base-snapshot.js";
import { emitYaml } from "../serialize/yaml.js";

const VEX_FIELDS = ["status", "justification", "response", "reason"] as const;
const PAGE_SIZE = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonRecord(value: Json | undefined): value is Record<string, Json> {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
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
  if (typeof value !== "string")
    throw new TypeError(`Platform finding ${field} must be a string or null`);
  return value;
}

function nestedComponent(
  row: Readonly<Record<string, Json>>,
): Readonly<Record<string, Json>> | null {
  const value = row["component"];
  return isJsonRecord(value) ? value : null;
}

function vexPayload(
  row: Readonly<Record<string, Json>>,
): Record<string, unknown> | null {
  const tuple = {
    status: optionalString(row, "vexStatus"),
    justification: optionalString(row, "vexJustification"),
    response: optionalString(row, "vexResponse"),
    reason: stripVexProvenance(optionalString(row, "vexReason")),
  };
  return Object.values(tuple).every((value) => value === null) ? null : tuple;
}

function legacyVexIdentity(
  row: Readonly<Record<string, Json>>,
): FindingIdentityInput | null {
  const component = nestedComponent(row);
  const componentId =
    optionalString(row, "componentId") ??
    (component === null ? null : optionalString(component, "id"));
  const cve = selectFindingCve({
    cve: optionalString(row, "cve"),
    findingIdentifier: optionalString(row, "findingIdentifier"),
    findingId: optionalString(row, "findingId"),
    vulnerabilityId: optionalString(row, "vulnerabilityId"),
  });
  if (componentId === null || cve === null) return null;
  const purl = optionalString(row, "componentPurl");
  const parsed = purlIdentity(purl);
  const fallback =
    optionalString(row, "componentFallbackIdentity") ?? componentId;
  return {
    cve,
    purl,
    name: parsed?.name ?? fallback,
    group: parsed?.group ?? null,
    version: parsed?.version ?? null,
  };
}

export class VexRemoteIdentityError extends TypeError {
  readonly code = "VEX_REMOTE_IDENTITY_MISSING";

  constructor(readonly findingId: string | null) {
    super("Platform finding is missing canonical identity");
    this.name = "VexRemoteIdentityError";
  }
}

export interface VexRemoteRowAdvisory {
  code: VexRemoteIdentityError["code"];
  findingId: string | null;
  message: string;
}

function findingIdentity(
  row: Readonly<Record<string, Json>>,
): CanonicalFindingIdentity {
  const identity = currentFindingIdentity(row);
  if (identity === null)
    throw new VexRemoteIdentityError(
      typeof row["id"] === "string" ? row["id"] : null,
    );
  return canonicalizeFindingIdentity(identity);
}

/** Computes the frozen exact canonical key for any normalized Platform finding. */
export function projectVexDecisionKey(
  row: Readonly<Record<string, Json>>,
): string {
  return canonicalFindingStableKey(findingIdentity(row));
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
export function createVexDecisionResolver(
  client: Pick<PlatformClient, "getFindings">,
): KeyResolver {
  const pending = new Map<string, Promise<ReadonlySet<string>>>();
  const serverKeys = (
    projectId: string,
    projectVersionId: string,
  ): Promise<ReadonlySet<string>> => {
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

async function yamlFiles(
  directory: string,
  projectId?: string,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (projectId !== undefined && entry.name !== projectId) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await yamlFiles(path)));
    if (
      entry.isFile() &&
      (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) &&
      entry.name !== "policy.yaml"
    ) {
      files.push(path);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function stringOrNull(
  value: unknown,
  field: string,
  file: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string")
    throw new SerializeError(file, 1, `${field} must be a string or null`);
  return value;
}

function componentIdentity(
  raw: Record<string, unknown>,
  file: string,
): {
  purl: string | null;
  name: string;
  group: string | null;
  version: string | null;
} {
  const purl = stringOrNull(raw["purl"], "component.purl", file);
  const parsed = purlIdentity(purl);
  const name = raw["name"];
  if (typeof name !== "string" && parsed === null) {
    throw new SerializeError(
      file,
      1,
      "component.name is required when component.purl cannot provide it",
    );
  }
  return {
    purl,
    name: typeof name === "string" ? name : (parsed?.name ?? ""),
    group:
      stringOrNull(raw["group"], "component.group", file) ??
      parsed?.group ??
      null,
    version:
      stringOrNull(raw["version"], "component.version", file) ??
      parsed?.version ??
      null,
  };
}

function authoredVexKey(
  cve: string,
  identity: ReturnType<typeof componentIdentity>,
  file: string,
): string {
  try {
    return canonicalFindingStableKey(
      canonicalizeFindingIdentity({ cve, ...identity }),
    );
  } catch (error: unknown) {
    throw new SerializeError(file, 1, "triage component identity is invalid", {
      cause: error,
    });
  }
}

function decisionPayload(
  raw: Record<string, unknown>,
  file: string,
): Record<string, unknown> {
  return Object.fromEntries(
    VEX_FIELDS.map((field) => [
      field,
      stringOrNull(raw[field], `decision.${field}`, file),
    ]),
  );
}

function aggregateDecisions(
  document: Record<string, unknown>,
  file: string,
): Array<{
  cve: string;
  identity: ReturnType<typeof componentIdentity>;
  payload: Record<string, unknown>;
}> {
  if (!isRecord(document["component"]) || !isRecord(document["decisions"])) {
    return [];
  }
  const identity = componentIdentity(document["component"], file);
  const result = [];
  for (const [cve, value] of Object.entries(document["decisions"])) {
    if (!isRecord(value))
      throw new SerializeError(file, 1, `decision ${cve} must be a mapping`);
    result.push({ cve, identity, payload: decisionPayload(value, file) });
  }
  return result;
}

function singleDecision(
  document: Record<string, unknown>,
  file: string,
): Array<{
  cve: string;
  identity: ReturnType<typeof componentIdentity>;
  payload: Record<string, unknown>;
}> {
  if (typeof document["cve"] !== "string") return [];
  return [
    {
      cve: document["cve"],
      identity: componentIdentity(document, file),
      payload: decisionPayload(document, file),
    },
  ];
}

/**
 * A typed parse failure that preserves entities from every valid triage file.
 * Engines surface `issues` while continuing with `partialWorking`.
 */
export class VexWorkingReadError extends SerializeError {
  readonly issues: readonly SerializeError[];
  readonly partialWorking: readonly WorkingEntity[];

  constructor(
    issues: readonly SerializeError[],
    partialWorking: readonly WorkingEntity[],
  ) {
    const first = issues[0];
    if (first === undefined)
      throw new TypeError("VexWorkingReadError requires at least one issue");
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
export async function readVexWorking(
  worktreeRoot: string,
  scope?: SyncScope,
): Promise<WorkingEntity[]> {
  const root = resolve(worktreeRoot);
  const serializer = createSerializer("vexDecision");
  const result: WorkingEntity[] = [];
  const keys = new Map<string, string>();
  const issues: SerializeError[] = [];
  for (const absoluteFile of await yamlFiles(
    join(root, ".fs", "triage"),
    scope?.projectId,
  )) {
    const file = normalizedFile(root, absoluteFile);
    try {
      const document = serializer.fromYaml(
        await readFile(absoluteFile, "utf8"),
        file,
      );
      const aggregate = aggregateDecisions(document, file);
      const decisions =
        aggregate.length > 0 ? aggregate : singleDecision(document, file);
      if (scope !== undefined && document["project"] !== scope.projectId) {
        throw new SerializeError(
          file,
          1,
          `overlay project must match sync scope ${scope.projectId}`,
        );
      }
      if (decisions.length === 0) {
        // Supplier proposals are a separate, local-only record class. They are
        // visible through the overlay projection but must never become sync
        // entities until a human writes a strict decision.
        if (isRecord(document["proposals"])) continue;
        throw new SerializeError(
          file,
          1,
          `${basename(file)} is not an fs-triage decision document`,
        );
      }
      const fileRows: WorkingEntity[] = [];
      const fileKeys = new Set<string>();
      for (const decision of decisions) {
        const key = authoredVexKey(decision.cve, decision.identity, file);
        const prior = keys.get(key);
        if (prior !== undefined || fileKeys.has(key)) {
          throw new SerializeError(
            file,
            1,
            `decision key is already authored in ${prior ?? file}`,
          );
        }
        fileKeys.add(key);
        fileRows.push({ key, payload: decision.payload, file });
      }
      for (const row of fileRows) {
        keys.set(row.key, file);
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
    await writeFile(temporary, contents, {
      encoding: "utf8",
      mode: metadata.mode,
    });
    await rename(temporary, file);
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export interface VexKeyMigration {
  key: string;
  identity: CanonicalFindingIdentity;
}

function rememberMigration(
  migrations: Map<string, VexKeyMigration>,
  legacyIdentity: FindingIdentityInput | null,
  canonical: CanonicalFindingIdentity,
): void {
  if (legacyIdentity === null) return;
  const legacyKey = legacyFindingStableKey(legacyIdentity);
  const canonicalKey = canonicalFindingStableKey(canonical);
  if (legacyKey === null || legacyKey === canonicalKey) return;
  const prior = migrations.get(legacyKey);
  if (prior !== undefined && prior.key !== canonicalKey) {
    throw new TypeError(`Legacy VEX key maps to multiple canonical identities`);
  }
  migrations.set(legacyKey, { key: canonicalKey, identity: canonical });
}

function rememberPersistedKeyMigration(
  migrations: Map<string, VexKeyMigration>,
  legacyKey: string | undefined,
  canonical: CanonicalFindingIdentity,
): void {
  if (legacyKey === undefined) return;
  const canonicalKey = canonicalFindingStableKey(canonical);
  if (legacyKey === canonicalKey) return;
  const prior = migrations.get(legacyKey);
  if (prior !== undefined && prior.key !== canonicalKey) {
    throw new TypeError(
      `Persisted finding key maps to multiple canonical identities`,
    );
  }
  migrations.set(legacyKey, { key: canonicalKey, identity: canonical });
}

function persistedFindingKeys(
  db: Database.Database | undefined,
  scope: SyncScope,
  rows: readonly Record<string, Json>[],
): ReadonlyMap<string, string> {
  if (db === undefined || rows.length === 0) return new Map();
  const ids = rows.map((row) => requiredString(row, "id"));
  const placeholders = ids.map(() => "?").join(", ");
  const persisted = db
    .prepare(
      `SELECT finding.finding_id AS findingId, finding.stable_key AS stableKey
         FROM findings AS finding
         JOIN sync_state AS state
           ON state.project_id = finding.project_id
          AND state.project_version_id = finding.project_version_id
          AND state.entity_kind = 'finding'
          AND state.accepted_generation_id = finding.generation_id
        WHERE finding.project_id = ? AND finding.project_version_id = ?
          AND finding.finding_id IN (${placeholders})`,
    )
    .all(scope.projectId, scope.projectVersionId, ...ids) as Array<{
    findingId: string;
    stableKey: string;
  }>;
  return new Map(persisted.map((row) => [row.findingId, row.stableKey]));
}

function writeCanonicalComponent(
  target: Record<string, unknown>,
  identity: CanonicalFindingIdentity,
): void {
  target["purl"] = identity.purl;
  target["name"] = identity.name;
  target["group"] = identity.group;
  // Authored values must reproduce the server key on the next read. The
  // decoded version is presentation-only; keyVersion retains wire identity.
  target["version"] = identity.keyVersion;
}

/** Applies the FS-173 declared old-to-new map while retaining decision tuples and provenance. */
export async function migrateVexWorkingKeys(
  worktreeRoot: string,
  scope: SyncScope,
  migrations: ReadonlyMap<string, VexKeyMigration>,
): Promise<number> {
  if (migrations.size === 0) return 0;
  const root = resolve(worktreeRoot);
  const serializer = createSerializer("vexDecision");
  let migrated = 0;
  for (const absoluteFile of await yamlFiles(
    join(root, ".fs", "triage"),
    scope.projectId,
  )) {
    const file = normalizedFile(root, absoluteFile);
    let document: Record<string, unknown>;
    try {
      document = serializer.fromYaml(
        await readFile(absoluteFile, "utf8"),
        file,
      );
    } catch (error: unknown) {
      if (error instanceof SerializeError) continue;
      throw error;
    }
    if (document["project"] !== scope.projectId) continue;
    let changed = false;
    if (isRecord(document["component"]) && isRecord(document["decisions"])) {
      let component: ReturnType<typeof componentIdentity>;
      try {
        component = componentIdentity(document["component"], file);
      } catch (error: unknown) {
        if (error instanceof SerializeError) continue;
        throw error;
      }
      let targetComponent: CanonicalFindingIdentity | null = null;
      const replacements: Array<{ from: string; to: string; value: unknown }> =
        [];
      for (const [cve, value] of Object.entries(document["decisions"])) {
        const oldKey = legacyFindingStableKey({ cve, ...component });
        const migration = oldKey === null ? undefined : migrations.get(oldKey);
        if (migration === undefined) continue;
        if (
          targetComponent !== null &&
          (targetComponent.purl !== migration.identity.purl ||
            targetComponent.name !== migration.identity.name ||
            targetComponent.group !== migration.identity.group ||
            targetComponent.keyVersion !== migration.identity.keyVersion)
        ) {
          throw new SerializeError(
            file,
            1,
            "one aggregate triage file maps to multiple canonical components",
          );
        }
        targetComponent = migration.identity;
        replacements.push({ from: cve, to: migration.identity.cve, value });
      }
      if (targetComponent !== null) {
        for (const replacement of replacements) {
          if (
            replacement.from !== replacement.to &&
            document["decisions"][replacement.to] !== undefined
          ) {
            throw new SerializeError(
              file,
              1,
              `canonical CVE ${replacement.to} is already authored`,
            );
          }
        }
        for (const replacement of replacements) {
          if (replacement.from !== replacement.to)
            delete document["decisions"][replacement.from];
          document["decisions"][replacement.to] = replacement.value;
          migrated += 1;
        }
        writeCanonicalComponent(document["component"], targetComponent);
        changed = true;
      }
    } else if (typeof document["cve"] === "string") {
      let component: ReturnType<typeof componentIdentity>;
      try {
        component = componentIdentity(document, file);
      } catch (error: unknown) {
        if (error instanceof SerializeError) continue;
        throw error;
      }
      const oldKey = legacyFindingStableKey({
        cve: document["cve"],
        ...component,
      });
      const migration = oldKey === null ? undefined : migrations.get(oldKey);
      if (migration !== undefined) {
        document["cve"] = migration.identity.cve;
        writeCanonicalComponent(document, migration.identity);
        migrated += 1;
        changed = true;
      }
    }
    if (changed) await atomicWrite(absoluteFile, emitYaml(document));
  }
  return migrated;
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
    const document = serializer.fromYaml(
      await readFile(absoluteFile, "utf8"),
      file,
    );
    let changed = false;
    if (isRecord(document["component"]) && isRecord(document["decisions"])) {
      const identity = componentIdentity(document["component"], file);
      for (const [cve, decision] of Object.entries(document["decisions"])) {
        if (!isRecord(decision)) continue;
        const key = authoredVexKey(cve, identity, file);
        const payload = base.get(key);
        if (payload === undefined) continue;
        decision["sync"] = {
          ...syncBlock(decision["sync"]),
          base: { ...payload },
        };
        changed = true;
      }
    } else if (typeof document["cve"] === "string") {
      const identity = componentIdentity(document, file);
      const key = authoredVexKey(document["cve"], identity, file);
      const payload = base.get(key);
      if (payload !== undefined) {
        document["sync"] = {
          ...syncBlock(document["sync"]),
          base: { ...payload },
        };
        changed = true;
      }
    }
    if (changed) await atomicWrite(absoluteFile, emitYaml(document));
  }
}

/** Creates the VEX adapter while closing over only its owning Platform client. */
export function createVexDecisionAdapter(
  client: Pick<PlatformClient, "getFindings">,
  db?: Database.Database,
  onAdvisory: (advisory: VexRemoteRowAdvisory) => void = () => undefined,
): EntityAdapter {
  const migrationsByScope = new Map<string, Map<string, VexKeyMigration>>();
  return {
    kind: "vexDecision",
    klass: "OVERLAY",
    serializer: createSerializer("vexDecision"),
    async *fetchRemote(scope, onProgress) {
      if (scope.projectVersionId === null) {
        throw new TypeError("vexDecision requires a project version");
      }
      let pageNumber = 0;
      const scopeKey = `${scope.projectId}\0${scope.projectVersionId}`;
      const migrations = new Map<string, VexKeyMigration>();
      migrationsByScope.set(scopeKey, migrations);
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
        const persistedKeys = persistedFindingKeys(db, scope, page.items);
        yield page.items.flatMap((row) => {
          let projected: ServerEntity | null;
          try {
            projected = projectVexDecision(row);
          } catch (error: unknown) {
            if (!(error instanceof VexRemoteIdentityError)) throw error;
            onAdvisory({
              code: error.code,
              findingId: error.findingId,
              message: error.message,
            });
            return [];
          }
          if (projected === null) {
            // Migration is best-effort for undecided rows: they are not VEX
            // entities and therefore must never make this pull key-dependent.
            try {
              const canonical = findingIdentity(row);
              rememberMigration(migrations, legacyVexIdentity(row), canonical);
              rememberPersistedKeyMigration(
                migrations,
                persistedKeys.get(requiredString(row, "id")),
                canonical,
              );
            } catch {
              // Deliberately ignored for a row that cannot produce an entity.
            }
            return [];
          }
          const canonical = findingIdentity(row);
          rememberMigration(migrations, legacyVexIdentity(row), canonical);
          rememberPersistedKeyMigration(
            migrations,
            persistedKeys.get(requiredString(row, "id")),
            canonical,
          );
          return [projected];
        });
      }
    },
    readWorking: readVexWorking,
    async migrateWorkingKeys(worktreeRoot, scope) {
      const scopeKey = `${scope.projectId}\0${scope.projectVersionId}`;
      const migrations = migrationsByScope.get(scopeKey);
      migrationsByScope.delete(scopeKey);
      if (migrations !== undefined)
        await migrateVexWorkingKeys(worktreeRoot, scope, migrations);
    },
  };
}

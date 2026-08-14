/**
 * Transport-neutral entity registration for the sync engine.
 *
 * @example Register an entity owned by another lane without editing L2:
 * ```ts
 * import { ASSURANCE_STUDIO_MAX_PAGE_SIZE } from "../../../lib/remote/assurance-studio/client.js";
 *
 * registerAdapter({
 *   kind: "requirement",
 *   klass: "VERSIONED",
 *   serializer: createSerializer("requirement"),
 *   async *fetchRemote(scope, onProgress) {
 *     let page = 0;
 *     for await (const remotePage of client.listEntities("requirement", {
 *       projectId: scope.projectId,
 *       page: { pageSize: ASSURANCE_STUDIO_MAX_PAGE_SIZE },
 *     })) {
 *       page += 1;
 *       onProgress({
 *         page,
 *         of: remotePage.total === null
 *           ? null
 *           : Math.ceil(remotePage.total / ASSURANCE_STUDIO_MAX_PAGE_SIZE),
 *       });
 *       yield remotePage.items.map(projectRequirement);
 *     }
 *   },
 *   readWorking: readRequirementFiles,
 * });
 * ```
 *
 * Adapter factories close over their lane's narrow client. The engine never
 * imports a transport or the cross-lane `RemoteServices` aggregate.
 *
 * The gate's shipped signatures deliberately use `SyncScope.projectVersionId`,
 * pass the pull `generationId` to every `CachePuller`, and return generation
 * fences (`generationId` and `acceptedAt`) in `PullReport`. Consumer lanes
 * must build against these signatures rather than the earlier WP sketch.
 */
import {
  ENTITIES,
  type EntityKind,
  type FindingIdentity,
} from "../../../lib/sync/registry.js";
import type { EntitySerializer } from "../serialize/serializer.js";

/** Project and optional project-version scope shared by every sync adapter. */
export interface SyncScope {
  /** Finite State project identifier understood by the owning remote client. */
  projectId: string;
  /** Version identifier, or `null` for project-level entities. */
  projectVersionId: string | null;
}

/** One normalized entity returned by a remote system of record. */
export interface ServerEntity {
  /** Frozen registry stable key. */
  key: string;
  /** Remote identifier used only for lookup and push, when the remote has one. */
  remoteId: string | null;
  /** Authored semantic payload after boundary projection. */
  payload: Record<string, unknown>;
}

/** One authored entity read from the working tree. */
export interface WorkingEntity {
  /** Frozen registry stable key. */
  key: string;
  /** Authored semantic payload parsed from disk. */
  payload: Record<string, unknown>;
  /** Normalized worktree-relative artifact path. */
  file: string;
}

/** Progress emitted while an adapter drains one remote page stream. */
export interface AdapterProgress {
  /** One-based page number. */
  page: number;
  /** Total pages when the remote reports a total, otherwise `null`. */
  of: number | null;
}

/** Lane-scoped non-fatal issue retained in a successful pull report. */
export interface AdapterAdvisory {
  code: string;
}

/**
 * Complete transport-neutral contract for a VERSIONED or OVERLAY entity.
 *
 * `fetchRemote` must yield exactly one array per fully received remote page.
 * Empty pages are significant because the engine checkpoints every page.
 */
export interface EntityAdapter {
  /** Registry kind, statically constrained to the frozen `EntityKind` union. */
  kind: EntityKind;
  /** Semantic class, which must match the frozen registry entry. */
  klass: "VERSIONED" | "OVERLAY";
  /** Serializer responsible for semantic normalization and content hashes. */
  serializer: EntitySerializer;
  /** Stream normalized remote pages without exposing transport details. */
  fetchRemote(
    scope: SyncScope,
    onProgress: (progress: AdapterProgress) => void,
    onAdvisory?: (advisory: AdapterAdvisory) => void,
  ): AsyncIterable<ServerEntity[]>;
  /** Read authored entities from `worktreeRoot`; malformed files reject with their typed parse error. */
  readWorking(
    worktreeRoot: string,
    scope?: SyncScope,
  ): Promise<WorkingEntity[]>;
  /** Apply a declared remote-key migration to authored files before local/base comparison. */
  migrateWorkingKeys?(worktreeRoot: string, scope: SyncScope): Promise<void>;
}

/** Optional full-domain context for finding resolvers that need more fidelity than the opaque key retains. */
export interface FindingResolverContext {
  readonly kind: "finding";
  readonly identity: FindingIdentity;
  readonly pin: "exact_version" | "any_version";
}

/**
 * Resolves an overlay key against the current canonical server corpus.
 * WP-17 uses exact matching; later lanes replace it with a tiered resolver.
 * Existing encoded-key-only callers remain valid; finding-aware callers may
 * supply the additive context needed for lossless purl fallback and exact versions.
 */
export type KeyResolver = (
  key: string,
  scope: SyncScope,
  context?: FindingResolverContext,
) => Promise<{ resolved: true; detail: unknown } | { resolved: false }>;

/**
 * Refreshes one CACHED surface into tables owned by the registering lane.
 * `generationId` binds those rows to the same atomic pull publication.
 * Pullers return current fetch work plus generation-owned publication and
 * quarantine totals. The persisted generation checkpoint is the authority
 * for the latter two counts.
 */
export type CachePuller = (
  scope: SyncScope,
  generationId: string,
  onProgress: (progress: AdapterProgress) => void,
) => Promise<
  Readonly<{ fetched: number; baseRows: number; quarantined: number }>
>;

/** Thrown when two lanes attempt to register an adapter for the same kind. */
export class DuplicateAdapterError extends Error {
  /** Creates a duplicate-registration failure for `kind`. */
  constructor(readonly kind: EntityKind) {
    super(`Sync adapter already registered for ${kind}`);
    this.name = "DuplicateAdapterError";
  }
}

/** Thrown when an adapter contradicts the frozen entity registry. */
export class InvalidAdapterError extends Error {
  /** Creates an invalid-adapter failure with a safe diagnostic. */
  constructor(message: string) {
    super(message);
    this.name = "InvalidAdapterError";
  }
}

const adapters = new Map<EntityKind, EntityAdapter>();
const resolvers = new Map<EntityKind, KeyResolver>();
const pushers = new Map<EntityKind, unknown>();
const cachePullers = new Map<EntityKind, CachePuller>();

/** Registers one adapter and rejects unknown, mismatched, or duplicate kinds. */
export function registerAdapter(adapter: EntityAdapter): void {
  if (!Object.hasOwn(ENTITIES, adapter.kind)) {
    throw new InvalidAdapterError(`Unknown sync adapter kind: ${adapter.kind}`);
  }
  const entry = ENTITIES[adapter.kind];
  if (entry.class !== "VERSIONED" && entry.class !== "OVERLAY") {
    throw new InvalidAdapterError(
      `${adapter.kind} cannot have a sync adapter because it is ${entry.class}`,
    );
  }
  if (entry.class !== adapter.klass) {
    throw new InvalidAdapterError(
      `${adapter.kind} adapter class ${adapter.klass} does not match registry class ${entry.class}`,
    );
  }
  if (adapter.serializer.entityKind !== adapter.kind) {
    throw new InvalidAdapterError(
      `${adapter.kind} adapter serializer belongs to ${adapter.serializer.entityKind}`,
    );
  }
  if (adapters.has(adapter.kind)) throw new DuplicateAdapterError(adapter.kind);
  adapters.set(adapter.kind, adapter);
}

/** Installs or replaces the key resolver for one registered semantic kind. */
export function registerResolver(
  kind: EntityKind,
  resolver: KeyResolver,
): void {
  if (ENTITIES[kind].class !== "OVERLAY") {
    throw new InvalidAdapterError(
      `${kind} cannot have a key resolver because it is not an OVERLAY entity`,
    );
  }
  resolvers.set(kind, resolver);
}

/**
 * Installs or replaces a pusher placeholder for one kind.
 *
 * WP-19 replaces `unknown` with the change-controlled `EntityPusher` contract.
 */
export function registerPusher(kind: EntityKind, pusher: unknown): void {
  pushers.set(kind, pusher);
}

/** Installs or replaces the pull function for a CACHED registry kind. */
export function registerCachePuller(
  kind: EntityKind,
  puller: CachePuller,
): void {
  if (ENTITIES[kind].class !== "CACHED") {
    throw new InvalidAdapterError(`${kind} is not a CACHED registry kind`);
  }
  cachePullers.set(kind, puller);
}

/** @internal Returns registered adapters in deterministic registry-kind order. */
export function registeredAdapters(): readonly EntityAdapter[] {
  return [...adapters.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind),
  );
}

/** @internal Returns the current resolver for `kind`, when another lane installed one. */
export function registeredResolver(kind: EntityKind): KeyResolver | undefined {
  return resolvers.get(kind);
}

/** @internal Returns registered cache pullers in deterministic registry-kind order. */
export function registeredCachePullers(): readonly Readonly<{
  kind: EntityKind;
  pull: CachePuller;
}>[] {
  return [...cachePullers.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, pull]) => ({ kind, pull }));
}

/** @internal Returns the current WP-19 pusher placeholder for `kind`. */
export function registeredPusher(kind: EntityKind): unknown {
  return pushers.get(kind);
}

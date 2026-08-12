import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  AsEntity,
  AsEntityKind,
  AsReviewStatus,
  Json,
} from "../../../lib/remote/types.js";

export interface AuditEntry {
  action: "seeded" | "created" | "updated" | "deleted";
  actor: string;
  at: string;
  entityId: string;
  kind: AsEntityKind;
  reviewVersion: string | null;
}

export interface MockAssuranceStudioState {
  readonly head: { versionId: string; workingHash: string };
  list(kind: AsEntityKind): AsEntity[];
  audit(kind: AsEntityKind, id: string): AuditEntry[];
  snapshot(): unknown;
  reset(): void;
}

export interface MockAssuranceStudioClock {
  now(): string;
}

export class MockAssuranceStudioError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    readonly details: Json,
  ) {
    super(code);
    this.name = "MockAssuranceStudioError";
  }
}

interface SeedEntity {
  id: string;
  projectId: string;
  kind: AsEntityKind;
  reviewVersion: string | null;
  reviewStatus: AsReviewStatus | null;
  humanEdited: boolean | null;
  fields: Record<string, Json>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parseJsonLines(path: string): SeedEntity[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SeedEntity);
}

function containsReference(value: Json, id: string): boolean {
  if (value === id) return true;
  if (Array.isArray(value)) return value.some((item) => containsReference(item, id));
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((item) => containsReference(item, id));
  }
  return false;
}

function detachReference(value: Json, id: string): Json | undefined {
  if (value === id) return undefined;
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const detached = detachReference(item, id);
      return detached === undefined ? [] : [detached];
    });
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) {
      const detached = detachReference(item, id);
      if (detached !== undefined) output[key] = detached;
    }
    return output;
  }
  return value;
}

function digest(entities: Iterable<AsEntity>): string {
  const ordered = [...entities].sort((left, right) =>
    `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
  );
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

export class AssuranceStudioState implements MockAssuranceStudioState {
  readonly #fixtureRoot: string;
  readonly #clock: MockAssuranceStudioClock;
  #entities = new Map<string, AsEntity>();
  #audits = new Map<string, AuditEntry[]>();
  #head = { versionId: "9007199254740996", workingHash: "" };
  #nextId = 1;

  constructor(fixtureRoot: string, clock: MockAssuranceStudioClock) {
    this.#fixtureRoot = fixtureRoot;
    this.#clock = clock;
    this.reset();
  }

  get head(): { versionId: string; workingHash: string } {
    return clone(this.#head);
  }

  list(kind: AsEntityKind): AsEntity[] {
    return [...this.#entities.values()]
      .filter((entity) => entity.kind === kind)
      .map(clone);
  }

  audit(kind: AsEntityKind, id: string): AuditEntry[] {
    return clone(this.#audits.get(`${kind}:${id}`) ?? []);
  }

  snapshot(): unknown {
    return {
      head: this.head,
      entities: [...this.#entities.values()].map(clone),
      audit: [...this.#audits.entries()].map(([key, entries]) => [key, clone(entries)]),
    };
  }

  reset(): void {
    const directory = resolve(this.#fixtureRoot, "assurance-studio");
    const seeded = [
      ...parseJsonLines(resolve(directory, "entities.jsonl")),
      ...parseJsonLines(resolve(directory, "requirements.jsonl")),
    ];
    this.#entities = new Map(seeded.map((entity) => [`${entity.kind}:${entity.id}`, clone(entity)]));
    this.#audits = new Map();
    for (const entity of seeded) {
      this.#audits.set(`${entity.kind}:${entity.id}`, [{
        action: "seeded",
        actor: "fixture:finite-state-eagle-v1",
        at: "2026-05-12T14:30:00.000Z",
        entityId: entity.id,
        kind: entity.kind,
        reviewVersion: entity.reviewVersion,
      }]);
    }
    this.#head = {
      versionId: "9007199254740996",
      workingHash: digest(this.#entities.values()),
    };
    this.#nextId = 1;
  }

  get(kind: AsEntityKind, id: string, projectId: string): AsEntity {
    const entity = this.#entities.get(`${kind}:${id}`);
    if (entity === undefined || entity.projectId !== projectId) {
      throw new MockAssuranceStudioError(404, "AS_ENTITY_NOT_FOUND", { kind, id });
    }
    return clone(entity);
  }

  create(kind: Exclude<AsEntityKind, "attack-path">, projectId: string, fields: Record<string, Json>): AsEntity {
    const id = `mock-${kind}-${this.#nextId++}`;
    const reviewStatus = fields.review_status;
    const entity: AsEntity = {
      id,
      projectId,
      kind,
      reviewVersion: "1",
      reviewStatus: reviewStatus === "pending" || reviewStatus === "ai_approved" ||
        reviewStatus === "ai_flagged" || reviewStatus === "human_approved" ||
        reviewStatus === "human_rejected" ? reviewStatus : "pending",
      humanEdited: true,
      fields: clone(fields),
    };
    delete entity.fields.review_status;
    this.#entities.set(`${kind}:${id}`, entity);
    this.#record("created", entity);
    this.#checkpoint();
    return clone(entity);
  }

  update(
    kind: AsEntityKind,
    id: string,
    projectId: string,
    fields: Record<string, Json>,
    force: boolean,
  ): AsEntity {
    const current = this.get(kind, id, projectId);
    const suppliedVersion = fields.review_version ?? fields.reviewVersion;
    if (!force && suppliedVersion !== current.reviewVersion) {
      throw new MockAssuranceStudioError(409, "AS_REVIEW_VERSION_CONFLICT", {
        expected: current.reviewVersion,
        received: suppliedVersion ?? null,
      });
    }
    const reviewStatus = fields.review_status ?? fields.reviewStatus;
    const nextFields = { ...current.fields, ...fields };
    delete nextFields.review_version;
    delete nextFields.reviewVersion;
    delete nextFields.review_status;
    delete nextFields.reviewStatus;
    const next: AsEntity = {
      ...current,
      fields: nextFields,
      humanEdited: true,
      reviewStatus: reviewStatus === "pending" || reviewStatus === "ai_approved" ||
        reviewStatus === "ai_flagged" || reviewStatus === "human_approved" ||
        reviewStatus === "human_rejected" ? reviewStatus : current.reviewStatus,
      reviewVersion: current.reviewVersion === null
        ? "1"
        : (BigInt(current.reviewVersion) + 1n).toString(),
    };
    this.#entities.set(`${kind}:${id}`, next);
    this.#record("updated", next);
    this.#checkpoint();
    return clone(next);
  }

  references(kind: AsEntityKind, id: string): AsEntity[] {
    return [...this.#entities.values()]
      .filter((entity) => !(entity.kind === kind && entity.id === id))
      .filter((entity) => containsReference(entity.fields, id))
      .map(clone);
  }

  delete(
    kind: AsEntityKind,
    id: string,
    projectId: string,
    mode?: "cascade" | "detach",
    force = false,
    visited = new Set<string>(),
  ): void {
    const key = `${kind}:${id}`;
    if (visited.has(key)) return;
    visited.add(key);
    const current = this.get(kind, id, projectId);
    const references = this.references(kind, id);
    if ((references.length > 0 || (current.humanEdited === true && !force)) && mode === undefined) {
      throw new MockAssuranceStudioError(409, "DeletionImpact", {
        entityType: kind,
        entityId: id,
        totalCount: references.length,
        dependencies: references.map((entity) => ({ entityType: entity.kind, entityId: entity.id })),
        recommendedAction: current.humanEdited === true ? "detach" : "cascade",
        allowedActions: ["detach", "cascade"],
        references: references.map((entity) => ({ kind: entity.kind, id: entity.id })),
      });
    }
    if (mode === "cascade") {
      for (const reference of references) {
        this.delete(reference.kind, reference.id, projectId, "cascade", force, visited);
      }
    } else if (mode === "detach") {
      for (const reference of references) {
        const detached = detachReference(reference.fields, id);
        reference.fields = detached !== undefined && !Array.isArray(detached) &&
          detached !== null && typeof detached === "object" ? detached : {};
        reference.humanEdited = true;
        reference.reviewVersion = reference.reviewVersion === null
          ? "1"
          : (BigInt(reference.reviewVersion) + 1n).toString();
        this.#entities.set(`${reference.kind}:${reference.id}`, reference);
        this.#record("updated", reference);
      }
    }
    this.#entities.delete(`${kind}:${id}`);
    this.#record("deleted", current);
    this.#checkpoint();
  }

  #record(action: AuditEntry["action"], entity: AsEntity): void {
    const key = `${entity.kind}:${entity.id}`;
    const entries = this.#audits.get(key) ?? [];
    entries.push({
      action,
      actor: "mock-admin",
      at: this.#clock.now(),
      entityId: entity.id,
      kind: entity.kind,
      reviewVersion: entity.reviewVersion,
    });
    this.#audits.set(key, entries);
  }

  #checkpoint(): void {
    this.#head = {
      versionId: (BigInt(this.#head.versionId) + 1n).toString(),
      workingHash: digest(this.#entities.values()),
    };
  }
}

export function createMockAssuranceStudioState(
  fixtureRoot: string,
  clock: MockAssuranceStudioClock = { now: () => "2026-05-12T14:30:00.000Z" },
): AssuranceStudioState {
  return new AssuranceStudioState(fixtureRoot, clock);
}

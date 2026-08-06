import { isAbsolute, normalize } from "node:path";

import {
  getNodeValue,
  parseTree,
  type Node,
  type ParseError,
} from "jsonc-parser";
import type {
  WorkTogetherRoomResourceRegistry,
  WorkTogetherRoomResourceTarget,
} from "./room-resource-provisioner.js";

export const WORK_TOGETHER_ROOM_RESOURCE_REGISTRY_ENV =
  "BB_WORK_TOGETHER_ROOM_RESOURCE_REGISTRY" as const;

const DOCUMENT_KEYS = ["repositories", "schemaVersion"] as const;
const ENTRY_KEYS = [
  "bbHostId",
  "candidateHostId",
  "projectName",
  "providerId",
  "providerRepositoryId",
  "sourcePath",
] as const;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BB_HOST_ID = /^host_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/u;
const PROVIDER_REPOSITORY_ID = /^[1-9][0-9]{0,127}$/u;
const PROVIDER_ID = /^[A-Za-z0-9._-]{1,64}$/u;

export interface ConfiguredWorkTogetherRoomResourceRegistry extends WorkTogetherRoomResourceRegistry {
  readonly configured: boolean;
}

export class WorkTogetherRoomResourceRegistryConfigError extends Error {
  constructor() {
    super("Invalid Work Together Room resource registry configuration");
    this.name = "WorkTogetherRoomResourceRegistryConfigError";
  }
}

function fail(): never {
  throw new WorkTogetherRoomResourceRegistryConfigError();
}

function parseStrictJson(text: string): unknown {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, {
    allowEmptyContent: false,
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (tree === undefined || errors.length > 0) fail();
  assertNoDuplicateProperties(tree);
  return getNodeValue(tree);
}

function assertNoDuplicateProperties(node: Node): void {
  if (node.type === "object") {
    const names = new Set<string>();
    for (const property of node.children ?? []) {
      if (
        property.type !== "property" ||
        property.children?.length !== 2 ||
        property.children[0]?.type !== "string"
      ) {
        fail();
      }
      const name = getNodeValue(property.children[0]);
      if (typeof name !== "string" || names.has(name)) fail();
      names.add(name);
      assertNoDuplicateProperties(property.children[1]!);
    }
    return;
  }
  for (const child of node.children ?? []) assertNoDuplicateProperties(child);
}

function exactObject(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail();
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail();
  }
  return record;
}

function targetFrom(value: unknown): {
  candidateHostId: string;
  providerRepositoryId: string;
  target: WorkTogetherRoomResourceTarget;
} {
  const record = exactObject(value, ENTRY_KEYS);
  if (
    typeof record.candidateHostId !== "string" ||
    !CANONICAL_UUID.test(record.candidateHostId) ||
    typeof record.providerRepositoryId !== "string" ||
    !PROVIDER_REPOSITORY_ID.test(record.providerRepositoryId) ||
    typeof record.bbHostId !== "string" ||
    !BB_HOST_ID.test(record.bbHostId) ||
    typeof record.providerId !== "string" ||
    !PROVIDER_ID.test(record.providerId) ||
    typeof record.projectName !== "string" ||
    record.projectName.length === 0 ||
    record.projectName !== record.projectName.trim() ||
    record.projectName.normalize("NFC") !== record.projectName ||
    [...record.projectName].length > 100 ||
    /[\u0000-\u001f\u007f]/u.test(record.projectName) ||
    typeof record.sourcePath !== "string" ||
    !isAbsolute(record.sourcePath) ||
    record.sourcePath === "/" ||
    normalize(record.sourcePath) !== record.sourcePath ||
    record.sourcePath !== record.sourcePath.trim() ||
    Buffer.byteLength(record.sourcePath, "utf8") > 4_096 ||
    /[\u0000-\u001f\u007f]/u.test(record.sourcePath)
  ) {
    fail();
  }
  return {
    candidateHostId: record.candidateHostId,
    providerRepositoryId: record.providerRepositoryId,
    target: Object.freeze({
      bbHostId: record.bbHostId,
      providerId: record.providerId,
      projectName: record.projectName,
      sourcePath: record.sourcePath,
    }),
  };
}

class StaticRoomResourceRegistry implements ConfiguredWorkTogetherRoomResourceRegistry {
  readonly #targets: ReadonlyMap<string, WorkTogetherRoomResourceTarget>;

  constructor(entries: ReturnType<typeof targetFrom>[]) {
    const targets = new Map<string, WorkTogetherRoomResourceTarget>();
    for (const entry of entries) {
      const key = `${entry.candidateHostId}\0${entry.providerRepositoryId}`;
      if (targets.has(key)) fail();
      targets.set(key, entry.target);
    }
    this.#targets = targets;
    Object.freeze(this);
  }

  get configured(): boolean {
    return this.#targets.size > 0;
  }

  resolve(input: {
    candidateHostId: string;
    providerRepositoryId: string;
  }): WorkTogetherRoomResourceTarget | null {
    if (
      typeof input?.candidateHostId !== "string" ||
      !CANONICAL_UUID.test(input.candidateHostId) ||
      typeof input.providerRepositoryId !== "string" ||
      !PROVIDER_REPOSITORY_ID.test(input.providerRepositoryId)
    ) {
      return null;
    }
    const target = this.#targets.get(
      `${input.candidateHostId}\0${input.providerRepositoryId}`,
    );
    return target === undefined ? null : Object.freeze({ ...target });
  }
}

export function loadWorkTogetherRoomResourceRegistry(
  raw: string | null | undefined,
): ConfiguredWorkTogetherRoomResourceRegistry {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return new StaticRoomResourceRegistry([]);
  }
  if (raw !== raw.trim()) fail();
  const document = exactObject(parseStrictJson(raw), DOCUMENT_KEYS);
  if (document.schemaVersion !== 1 || !Array.isArray(document.repositories))
    fail();
  return new StaticRoomResourceRegistry(
    document.repositories.map((entry) => targetFrom(entry)),
  );
}

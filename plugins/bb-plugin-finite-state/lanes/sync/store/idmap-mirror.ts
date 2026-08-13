import {
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { IdMapEntry } from "./id-map.js";

export interface IdmapMirrorValue {
  projectId: string;
  projectVersionId: string;
  acceptedGenerationIds: Readonly<Record<string, string>>;
  baseRevisions: Readonly<Record<string, number>>;
  entries: IdMapEntry[];
}

export class IdmapMirrorInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdmapMirrorInputError";
  }
}

export class IdmapMirrorWriteError extends Error {
  constructor(readonly file: string, options: ErrorOptions) {
    super(`Unable to atomically write id-map mirror at ${file}`, options);
    this.name = "IdmapMirrorWriteError";
  }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function orderedRecord<T>(value: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => compare(left, right)),
  );
}

function deterministicValue(value: IdmapMirrorValue): IdmapMirrorValue {
  if (value.projectId.length === 0 || value.projectVersionId.length === 0) {
    throw new IdmapMirrorInputError("projectId and projectVersionId must not be empty");
  }
  for (const [kind, generationId] of Object.entries(value.acceptedGenerationIds)) {
    if (kind.length === 0 || generationId.length === 0) {
      throw new IdmapMirrorInputError(
        "accepted generation kinds and ids must not be empty",
      );
    }
  }
  for (const [kind, revision] of Object.entries(value.baseRevisions)) {
    if (kind.length === 0 || !Number.isInteger(revision) || revision < 0) {
      throw new IdmapMirrorInputError(
        "base revisions must be non-negative integers keyed by kind",
      );
    }
  }

  const seen = new Set<string>();
  const entries = value.entries.map((entry) => {
    if (
      entry.projectId !== value.projectId
      || entry.projectVersionId !== value.projectVersionId
    ) {
      throw new IdmapMirrorInputError(
        "Every id-map entry must match the mirror project and version",
      );
    }
    if (value.acceptedGenerationIds[entry.entityKind] !== entry.generationId) {
      throw new IdmapMirrorInputError(
        `Entry ${entry.entityKind}/${entry.entityKey} is not in the accepted generation`,
      );
    }
    const key = `${entry.entityKind}\u0000${entry.entityKey}`;
    if (seen.has(key)) {
      throw new IdmapMirrorInputError(
        `Duplicate id-map entry ${entry.entityKind}/${entry.entityKey}`,
      );
    }
    seen.add(key);
    return {
      projectId: entry.projectId,
      projectVersionId: entry.projectVersionId,
      entityKind: entry.entityKind,
      generationId: entry.generationId,
      entityKey: entry.entityKey,
      remoteId: entry.remoteId,
    };
  }).sort((left, right) =>
    compare(left.entityKind, right.entityKind)
    || compare(left.entityKey, right.entityKey));

  return {
    projectId: value.projectId,
    projectVersionId: value.projectVersionId,
    acceptedGenerationIds: orderedRecord(value.acceptedGenerationIds),
    baseRevisions: orderedRecord(value.baseRevisions),
    entries,
  };
}

export function writeIdmapMirror(
  worktreeRoot: string,
  value: IdmapMirrorValue,
): void {
  if (worktreeRoot.length === 0) {
    throw new IdmapMirrorInputError("worktreeRoot must not be empty");
  }
  const directory = join(worktreeRoot, ".fs-sync");
  const target = join(directory, "idmap.json");
  const temporary = join(
    directory,
    `.idmap.json.${process.pid}.${randomUUID()}.tmp`,
  );
  const bytes = `${JSON.stringify(deterministicValue(value), null, 2)}\n`;

  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(temporary, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, target);
  } catch (cause) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temp file may not have been created; the typed write error is primary.
    }
    throw new IdmapMirrorWriteError(target, { cause });
  }
}

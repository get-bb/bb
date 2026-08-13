import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { ENTITIES, type EntityKind } from "../../../lib/sync/registry.js";
import type { Plan } from "../plan/index.js";
import type { PushDeps, PushErrorDetail } from "./types.js";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PUSH_PAGE = /^fspush1:([A-Za-z0-9][A-Za-z0-9._-]{0,127}):([0-9]+)$/u;

export interface PushSidecar {
  version: 1;
  runId: string;
  planId: string;
  planSha256: string;
  scope: { projectId: string; projectVersionId: string | null };
  baseGenerationIds: Record<string, string>;
  baseRevisions: Record<string, number>;
  expectedBaseStateSha256: string;
  confirmed: boolean;
  ordered: Array<{ kind: EntityKind; key: string }>;
  cursor: number;
  requiresPull: boolean;
  terminalError: PushErrorDetail | null;
  createdAt: string;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((entry) => (
    typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0
  ));
}

function isKind(value: unknown): value is EntityKind {
  return typeof value === "string" && Object.hasOwn(ENTITIES, value);
}

function parseTerminalError(value: unknown): PushErrorDetail | null {
  if (value === null) return null;
  if (
    !isRecord(value)
    || typeof value["code"] !== "string"
    || typeof value["message"] !== "string"
    || value["message"].length > 500
    || typeof value["retryable"] !== "boolean"
  ) {
    throw new Error("Push sidecar terminal error is invalid");
  }
  return {
    code: value["code"],
    message: value["message"],
    retryable: value["retryable"],
  };
}

function parseSidecar(value: unknown): PushSidecar {
  if (
    !isRecord(value)
    || value["version"] !== 1
    || typeof value["runId"] !== "string"
    || !RUN_ID.test(value["runId"])
    || typeof value["planId"] !== "string"
    || typeof value["planSha256"] !== "string"
    || !isRecord(value["scope"])
    || typeof value["scope"]["projectId"] !== "string"
    || (value["scope"]["projectVersionId"] !== null
      && typeof value["scope"]["projectVersionId"] !== "string")
    || !isStringRecord(value["baseGenerationIds"])
    || !isNumberRecord(value["baseRevisions"])
    || typeof value["expectedBaseStateSha256"] !== "string"
    || typeof value["confirmed"] !== "boolean"
    || !Array.isArray(value["ordered"])
    || !value["ordered"].every((entry) => (
      isRecord(entry) && isKind(entry["kind"]) && typeof entry["key"] === "string"
    ))
    || typeof value["cursor"] !== "number"
    || !Number.isSafeInteger(value["cursor"])
    || value["cursor"] < 0
    || value["cursor"] > value["ordered"].length
    || typeof value["requiresPull"] !== "boolean"
    || typeof value["createdAt"] !== "string"
    || typeof value["updatedAt"] !== "string"
  ) {
    throw new Error("Push sidecar does not satisfy the resumability contract");
  }
  return {
    version: 1,
    runId: value["runId"],
    planId: value["planId"],
    planSha256: value["planSha256"],
    scope: {
      projectId: value["scope"]["projectId"],
      projectVersionId: value["scope"]["projectVersionId"],
    },
    baseGenerationIds: value["baseGenerationIds"],
    baseRevisions: value["baseRevisions"],
    expectedBaseStateSha256: value["expectedBaseStateSha256"],
    confirmed: value["confirmed"],
    ordered: value["ordered"].map((entry) => {
      if (!isRecord(entry) || !isKind(entry["kind"]) || typeof entry["key"] !== "string") {
        throw new Error("Push sidecar ordered item is invalid");
      }
      return { kind: entry["kind"], key: entry["key"] };
    }),
    cursor: value["cursor"],
    requiresPull: value["requiresPull"],
    terminalError: parseTerminalError(value["terminalError"]),
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
  };
}

function sidecarRoot(deps: PushDeps): string | null {
  if (deps.worktreeRoot !== undefined && deps.worktreeRoot !== null) {
    return deps.worktreeRoot;
  }
  if (deps.db.memory || deps.db.name.length === 0) return null;
  return dirname(resolve(deps.db.name));
}

function sidecarPath(deps: PushDeps, runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error("PUSH_RUN_ID_INVALID: run id is not sidecar-safe");
  const root = sidecarRoot(deps);
  if (root === null) throw new Error("PUSH_PERSISTENCE_UNAVAILABLE: push requires a durable sidecar root");
  return join(root, ".fs-sync", `push-${runId}.json`);
}

function sameIdentity(left: PushSidecar, right: PushSidecar): boolean {
  return left.runId === right.runId
    && left.planId === right.planId
    && left.planSha256 === right.planSha256
    && left.scope.projectId === right.scope.projectId
    && left.scope.projectVersionId === right.scope.projectVersionId
    && JSON.stringify(left.baseGenerationIds) === JSON.stringify(right.baseGenerationIds)
    && JSON.stringify(left.baseRevisions) === JSON.stringify(right.baseRevisions)
    && left.expectedBaseStateSha256 === right.expectedBaseStateSha256
    && left.confirmed === right.confirmed
    && JSON.stringify(left.ordered) === JSON.stringify(right.ordered);
}

async function writeSidecar(deps: PushDeps, sidecar: PushSidecar): Promise<void> {
  const destination = sidecarPath(deps, sidecar.runId);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(sidecar, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, destination);
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function newSidecar(plan: Plan, runId: string, confirmed: boolean, now: Date): PushSidecar {
  if (!RUN_ID.test(runId)) throw new Error("PUSH_RUN_ID_INVALID: run id is not sidecar-safe");
  const timestamp = now.toISOString();
  return {
    version: 1,
    runId,
    planId: plan.planId,
    planSha256: plan.planSha256,
    scope: { projectId: plan.projectId, projectVersionId: plan.projectVersionId },
    baseGenerationIds: { ...plan.baseGenerationIds },
    baseRevisions: { ...plan.baseRevisions },
    expectedBaseStateSha256: plan.baseStateSha256,
    confirmed,
    ordered: plan.items.map((item) => ({ kind: item.kind, key: item.key })),
    cursor: 0,
    requiresPull: false,
    terminalError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function initializeSidecar(
  deps: PushDeps,
  candidate: PushSidecar,
): Promise<PushSidecar> {
  const existing = loadPushSidecar(deps, candidate.runId);
  if (existing !== null) {
    if (!sameIdentity(existing, candidate)) {
      throw new Error("PUSH_RUN_ID_REUSED: run id belongs to another persisted push");
    }
    return existing;
  }
  await writeSidecar(deps, candidate);
  return candidate;
}

export function loadPushSidecar(deps: PushDeps, runId: string): PushSidecar | null {
  try {
    return parseSidecar(JSON.parse(readFileSync(sidecarPath(deps, runId), "utf8")));
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") return null;
    if (error instanceof SyntaxError) throw new Error("Push sidecar contains invalid JSON", { cause: error });
    throw error;
  }
}

export async function updatePushSidecar(
  deps: PushDeps,
  sidecar: PushSidecar,
  update: Partial<Pick<PushSidecar, "cursor" | "requiresPull" | "terminalError">>,
): Promise<PushSidecar> {
  const current = loadPushSidecar(deps, sidecar.runId);
  if (current === null || !sameIdentity(current, sidecar)) {
    throw new Error("PUSH_SIDECAR_MOVED: persisted push identity changed");
  }
  const next: PushSidecar = {
    ...current,
    ...update,
    updatedAt: (deps.now?.() ?? new Date()).toISOString(),
  };
  await writeSidecar(deps, next);
  return next;
}

export function encodePushContinuation(runId: string, offset: number): string {
  if (!RUN_ID.test(runId) || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("PUSH_CONTINUATION_INVALID: invalid run or offset");
  }
  return `fspush1:${runId}:${offset}`;
}

export function decodePushContinuation(continuation: string): { runId: string; offset: number } {
  const matched = PUSH_PAGE.exec(continuation);
  const offset = matched?.[2] === undefined ? Number.NaN : Number(matched[2]);
  if (matched?.[1] === undefined || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("PUSH_CONTINUATION_INVALID: malformed push continuation");
  }
  return { runId: matched[1], offset };
}

export async function readSidecarText(deps: PushDeps, runId: string): Promise<string> {
  return await readFile(sidecarPath(deps, runId), "utf8");
}

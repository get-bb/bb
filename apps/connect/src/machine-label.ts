import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  HANDLE_MAX_LENGTH,
  machine,
  schema,
  validateLabel,
  type ConnectDb,
} from "@bb/connect-db";
import { verifyMachineCredentialDetails } from "./session.js";
import { MACHINE_CREDENTIAL_HEADER } from "./protocol-headers.js";
import type { Env } from "./tunnel-do.js";

function fallbackLabel(machineId: string): string {
  const idPrefix = machineId
    .replace(/[^a-z0-9]/giu, "")
    .toLowerCase()
    .slice(0, 8);
  return `machine-${idPrefix || "unknown"}`;
}

export function sanitizeMachineLabelBase(
  desiredName: string,
  machineId: string,
): string {
  const label = desiredName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, HANDLE_MAX_LENGTH)
    .replace(/-+$/gu, "");
  return label.length > 0 && validateLabel(label) === null
    ? label
    : fallbackLabel(machineId);
}

function labelWithSuffix(base: string, ordinal: number): string {
  if (ordinal === 1) return base;
  const suffix = `-${ordinal}`;
  const stem = base
    .slice(0, HANDLE_MAX_LENGTH - suffix.length)
    .replace(/-+$/gu, "");
  return `${stem}${suffix}`;
}

type MachineUpdateResult = { changes: number } | { meta: { changes: number } };

function affectedRows(result: MachineUpdateResult): number {
  return "changes" in result ? result.changes : result.meta.changes;
}

interface MachineLabelAssignmentHooks {
  beforeAttach?: (candidate: string) => Promise<void>;
}

function isLabelCollision(error: Error): boolean {
  return error instanceof Error && /unique constraint/iu.test(error.message);
}

export async function assignMachineLabel(
  db: ConnectDb,
  machineId: string,
  desiredName: string,
  hooks: MachineLabelAssignmentHooks = {},
): Promise<string | null> {
  const row = await db
    .select({
      subdomain: machine.subdomain,
      revokedAt: machine.revokedAt,
    })
    .from(machine)
    .where(eq(machine.id, machineId))
    .get();
  if (!row) return null;
  if (row.subdomain !== null) return row.subdomain;
  if (row.revokedAt !== null) return null;

  const base = sanitizeMachineLabelBase(desiredName, machineId);
  for (let ordinal = 1; ; ordinal += 1) {
    const candidate = labelWithSuffix(base, ordinal);
    await hooks.beforeAttach?.(candidate);
    let updateResult: unknown;
    try {
      updateResult = await db
        .update(machine)
        .set({ subdomain: candidate })
        .where(
          and(
            eq(machine.id, machineId),
            isNull(machine.subdomain),
            isNull(machine.revokedAt),
          ),
        )
        .run();
    } catch (error) {
      if (error instanceof Error && isLabelCollision(error)) continue;
      throw error;
    }
    const updateResultObject = Object(updateResult);
    const directChanges =
      "changes" in updateResultObject ? updateResultObject.changes : undefined;
    const meta =
      "meta" in updateResultObject && updateResultObject.meta instanceof Object
        ? updateResultObject.meta
        : null;
    const metaChanges =
      meta !== null && "changes" in meta ? meta.changes : undefined;
    const parsedUpdateResult: MachineUpdateResult | null = Number.isInteger(
      directChanges,
    )
      ? { changes: Number(directChanges) }
      : Number.isInteger(metaChanges)
        ? { meta: { changes: Number(metaChanges) } }
        : null;
    if (parsedUpdateResult === null) {
      throw new Error("machine label update did not report affected rows");
    }
    if (affectedRows(parsedUpdateResult) === 1) return candidate;

    const current = await db
      .select({ subdomain: machine.subdomain, revokedAt: machine.revokedAt })
      .from(machine)
      .where(eq(machine.id, machineId))
      .get();
    if (!current || current.revokedAt !== null) return null;
    if (current.subdomain !== null) return current.subdomain;
  }
}

export async function assignMachineLabelForCredential(
  db: ConnectDb,
  credential: string,
  desiredName: string,
): Promise<string | null> {
  const verified = await verifyMachineCredentialDetails(credential, db);
  if (!verified) return null;
  return assignMachineLabel(db, verified.machineId, desiredName);
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export async function handleAssignMachineLabel(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        allow: "POST",
      },
    });
  }

  const db = drizzle(env.DB, { schema });
  const credential = request.headers.get(MACHINE_CREDENTIAL_HEADER) ?? "";
  const body: unknown = await request.json().catch(() => null);
  if (
    !(body instanceof Object) ||
    Array.isArray(body) ||
    !("desiredName" in body) ||
    String(body.desiredName) !== body.desiredName
  ) {
    return jsonError("invalid_request", 400);
  }

  const label = await assignMachineLabelForCredential(
    db,
    credential,
    body.desiredName,
  );
  if (label === null) return jsonError("unauthorized", 401);
  return Response.json({ label });
}

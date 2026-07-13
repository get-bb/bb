import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  HANDLE_MAX_LENGTH,
  checkLabelAvailability,
  machine,
  schema,
  validateLabel,
  type ConnectDb,
} from "@bb/connect-db";
import { verifyMachineCredentialDetails } from "./session.js";
import type { Env } from "./tunnel-do.js";

const MACHINE_CREDENTIAL_HEADER = "x-bb-connect-machine";

function fallbackLabel(machineId: string): string {
  const idPrefix = machineId
    .replace(/[^a-z0-9]/giu, "")
    .toLowerCase()
    .slice(0, 8);
  return `machine-${idPrefix || "unknown"}`;
}

/** Convert a human-readable host name to the shared public-label grammar. */
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

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /unique constraint/iu.test(error.message);
}

/** Assign once, suffixing through the namespace on collisions. */
export async function assignMachineLabel(
  db: ConnectDb,
  machineId: string,
  desiredName: string,
): Promise<string | null> {
  const row = await db
    .select({ subdomain: machine.subdomain })
    .from(machine)
    .where(eq(machine.id, machineId))
    .get();
  if (!row) return null;
  if (row.subdomain !== null) return row.subdomain;

  const base = sanitizeMachineLabelBase(desiredName, machineId);
  for (let ordinal = 1; ; ordinal += 1) {
    const candidate = labelWithSuffix(base, ordinal);
    const availability = await checkLabelAvailability(db, candidate);
    if (!availability.available) continue;
    try {
      await db
        .update(machine)
        .set({ subdomain: candidate })
        .where(and(eq(machine.id, machineId), isNull(machine.subdomain)))
        .run();
      const assigned = await db
        .select({ subdomain: machine.subdomain })
        .from(machine)
        .where(eq(machine.id, machineId))
        .get();
      if (!assigned) return null;
      if (assigned.subdomain !== null) return assigned.subdomain;
    } catch (error) {
      // Another claim can win after the availability read. The database's
      // unique constraints are authoritative; retry with the next suffix.
      if (!isUniqueConstraintError(error)) throw error;
    }
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

/** `POST /api/connect/machine-label`, authenticated by the daemon credential. */
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
    typeof body !== "object" ||
    body === null ||
    !("desiredName" in body) ||
    typeof body.desiredName !== "string"
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

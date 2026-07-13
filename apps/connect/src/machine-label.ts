import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  HANDLE_MAX_LENGTH,
  machine,
  releaseLabelClaim,
  schema,
  tryClaimLabel,
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

function affectedRows(result: unknown): number | null {
  if (typeof result !== "object" || result === null) return null;
  if ("changes" in result && typeof result.changes === "number") {
    return result.changes;
  }
  if (
    "meta" in result &&
    typeof result.meta === "object" &&
    result.meta !== null &&
    "changes" in result.meta &&
    typeof result.meta.changes === "number"
  ) {
    return result.meta.changes;
  }
  return null;
}

export interface MachineLabelAssignmentHooks {
  /** Test/control barrier after the global claim is won, before machine attach. */
  afterClaim?: (candidate: string) => Promise<void>;
}

/** Assign once, suffixing through the namespace on collisions. */
export async function assignMachineLabel(
  db: ConnectDb,
  machineId: string,
  desiredName: string,
  hooks: MachineLabelAssignmentHooks = {},
): Promise<string | null> {
  const row = await db
    .select({
      subdomain: machine.subdomain,
      userId: machine.userId,
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
    const generation = crypto.randomUUID();
    const claimed = await tryClaimLabel(db, {
      label: candidate,
      kind: "machine",
      ownerId: machineId,
      userId: row.userId,
      generation,
      createdAt: new Date(),
    });
    if (!claimed) continue;

    let updateResult: unknown;
    try {
      await hooks.afterClaim?.(candidate);
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
      try {
        await releaseLabelClaim(db, {
          label: candidate,
          kind: "machine",
          ownerId: machineId,
          generation,
        });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "machine label assignment and claim cleanup failed",
        );
      }
      throw error;
    }
    const changes = affectedRows(updateResult);
    if (changes === 1) return candidate;

    const current = await db
      .select({ subdomain: machine.subdomain, revokedAt: machine.revokedAt })
      .from(machine)
      .where(eq(machine.id, machineId))
      .get();
    // Some drivers do not report affected-row counts. The exact attached row
    // is authoritative and must retain the claim in that case.
    if (
      changes === null &&
      current?.revokedAt === null &&
      current.subdomain === candidate
    ) {
      return candidate;
    }

    await releaseLabelClaim(db, {
      label: candidate,
      kind: "machine",
      ownerId: machineId,
      generation,
    });
    if (!current || current.revokedAt !== null) return null;
    if (current.subdomain !== null) return current.subdomain;
    if (changes === null) {
      throw new Error("machine label update did not report affected rows");
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

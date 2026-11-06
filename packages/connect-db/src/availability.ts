import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { type HandleValidationError, validateLabel } from "./constants.js";
import { first } from "./query.js";
import { labelClaim, type schema } from "./schema.js";

export type ConnectDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export type LabelAvailability =
  | { available: true; label: string }
  | { available: false; reason: "invalid"; error: HandleValidationError }
  | {
      available: false;
      reason: "taken";
      namespace: "handle" | "subdomain" | "machine";
    };

export async function checkLabelAvailability(
  db: ConnectDb,
  rawLabel: string,
): Promise<LabelAvailability> {
  const label = rawLabel.trim().toLowerCase();

  const invalid = validateLabel(label);
  if (invalid) return { available: false, reason: "invalid", error: invalid };

  const claim = await first(
    db
      .select({ kind: labelClaim.kind })
      .from(labelClaim)
      .where(eq(labelClaim.label, label))
      .limit(1),
  );
  if (claim) {
    return {
      available: false,
      reason: "taken",
      namespace: claim.kind === "server" ? "subdomain" : claim.kind,
    };
  }

  return { available: true, label };
}

export function machineRoutingKey(label: string, generation: string): string {
  return `${label}:${generation}`;
}

import { z } from "zod";
import { principalKindValues, type PrincipalKind } from "./principal.js";

/**
 * Immutable snapshot of who authored a durable mutation or event.
 * Server-derived only — never accepted from browser/plugin/daemon payloads.
 */
export type ActorStamp = {
  readonly principalId: string;
  readonly principalKind: PrincipalKind;
  readonly displayName: string;
};

export const actorStampSchema = z
  .object({
    principalId: z.string().min(1),
    principalKind: z.enum(principalKindValues),
    displayName: z.string().min(1),
  })
  .strict();

/**
 * Explicit representation for pre-actor / migrated rows whose actor triple is
 * entirely null. Never a guessed human — always a stable system stamp.
 */
export const LEGACY_SYSTEM_ACTOR_STAMP: ActorStamp = Object.freeze({
  principalId: "system:legacy",
  principalKind: "system",
  displayName: "System (legacy)",
});

/** Stable system stamp for server lifecycle/recovery events. */
export const SYSTEM_ACTOR_STAMP: ActorStamp = Object.freeze({
  principalId: "system:bb",
  principalKind: "system",
  displayName: "System",
});

export function parseActorStamp(value: unknown): ActorStamp {
  return actorStampSchema.parse(value);
}

export function actorStampsEqual(a: ActorStamp, b: ActorStamp): boolean {
  return (
    a.principalId === b.principalId &&
    a.principalKind === b.principalKind &&
    a.displayName === b.displayName
  );
}

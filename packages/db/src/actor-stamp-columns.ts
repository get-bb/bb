import {
  LEGACY_SYSTEM_ACTOR_STAMP,
  actorStampSchema,
  type ActorStamp,
  type PrincipalKind,
} from "@bb/domain";

export type ActorStampColumns = {
  readonly actorPrincipalId: string | null;
  readonly actorKind: string | null;
  readonly actorDisplayName: string | null;
};

export type ActorStampColumnTriple = {
  readonly actorPrincipalId: string;
  readonly actorKind: PrincipalKind;
  readonly actorDisplayName: string;
};

export function encodeActorStampColumns(
  actor: ActorStamp,
): ActorStampColumnTriple {
  const parsed = actorStampSchema.parse(actor);
  return {
    actorPrincipalId: parsed.principalId,
    actorKind: parsed.principalKind,
    actorDisplayName: parsed.displayName,
  };
}

export function decodeActorStampFromColumns(
  columns: ActorStampColumns,
): ActorStamp {
  const values = [
    columns.actorPrincipalId,
    columns.actorKind,
    columns.actorDisplayName,
  ];
  if (values.every((value) => value === null)) {
    return LEGACY_SYSTEM_ACTOR_STAMP;
  }
  if (values.some((value) => value === null)) {
    throw new Error(
      "Corrupt actor stamp: actor columns must be all present or all null",
    );
  }
  return actorStampSchema.parse({
    principalId: columns.actorPrincipalId,
    principalKind: columns.actorKind,
    displayName: columns.actorDisplayName,
  });
}

export function actorStampColumnsOrNull(
  actor: ActorStamp | null | undefined,
): ActorStampColumns {
  if (actor == null) {
    return {
      actorPrincipalId: null,
      actorKind: null,
      actorDisplayName: null,
    };
  }
  return encodeActorStampColumns(actor);
}

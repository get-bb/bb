export const WORK_TOGETHER_ROOM_VISIBLE_DISALLOWED_CONTROL =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export type WorkTogetherRoomVisibleScalarIdentityV1 = Readonly<{
  bindingId: string;
  environmentId: string;
  privateThreadId: string;
  projectId: string;
  publicStreamId: string;
}>;

/**
 * Room-visible scalar policy: NFC, private-identity substitution, control and
 * UTF-8 byte bounds. Returns null when a safe value cannot be produced.
 */
export function projectWorkTogetherRoomVisibleScalar(
  value: string,
  identity: WorkTogetherRoomVisibleScalarIdentityV1,
  maxBytes: number,
  requireNonBlank: boolean,
): string | null {
  let projected = value.normalize("NFC");
  projected = projected.replaceAll(
    identity.privateThreadId,
    identity.publicStreamId,
  );
  projected = projected.replaceAll(
    identity.environmentId,
    `${identity.bindingId}:environment`,
  );
  projected = projected.replaceAll(
    identity.projectId,
    `${identity.bindingId}:project`,
  );
  if (
    WORK_TOGETHER_ROOM_VISIBLE_DISALLOWED_CONTROL.test(projected) ||
    Buffer.byteLength(projected, "utf8") > maxBytes ||
    (requireNonBlank && projected.trim().length === 0)
  ) {
    return null;
  }
  return projected;
}

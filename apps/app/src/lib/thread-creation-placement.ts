export interface ThreadCreationPlacement {
  sectionId: string | null;
  pinned: boolean;
}

export const DEFAULT_THREAD_CREATION_PLACEMENT: ThreadCreationPlacement = {
  sectionId: null,
  pinned: false,
};

export function readThreadCreationPlacement(
  state: unknown,
): ThreadCreationPlacement | null {
  if (typeof state !== "object" || state === null || !("placement" in state))
    return null;
  const value = state.placement;
  if (
    typeof value !== "object" ||
    value === null ||
    !("sectionId" in value) ||
    !("pinned" in value)
  )
    return null;
  if (typeof value.pinned !== "boolean") return null;
  if (
    value.sectionId !== null &&
    (typeof value.sectionId !== "string" || value.sectionId.trim().length === 0)
  )
    return null;
  return { sectionId: value.sectionId, pinned: value.pinned };
}

import type { Draft } from "@bb/server-contract";
import type { RecoverableDraftSnapshot } from "./resource-store";

type DraftListContent = Pick<Draft, "id" | "content" | "updatedAt">;

export interface DraftListEntry extends DraftListContent {
  recoveryStatus: RecoverableDraftSnapshot["status"] | null;
}

export function mergeDraftListEntries(
  remote: readonly DraftListContent[],
  local: readonly RecoverableDraftSnapshot[],
): DraftListEntry[] {
  const entries = new Map<string, DraftListEntry>();
  for (const draft of remote) {
    entries.set(draft.id, { ...draft, recoveryStatus: null });
  }
  for (const draft of local) {
    entries.set(draft.id, { ...draft, recoveryStatus: draft.status });
  }
  return [...entries.values()]
    .filter(
      (draft) =>
        draft.content.prompt.text.length > 0 ||
        draft.content.prompt.attachments.length > 0,
    )
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
    );
}

export function getDraftDisplayTitle(draft: DraftListContent): string {
  return (
    draft.content.prompt.text.trim() ||
    draft.content.prompt.attachments[0]?.name ||
    "Untitled draft"
  );
}

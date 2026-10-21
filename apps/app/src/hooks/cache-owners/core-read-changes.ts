import type { QueryClient } from "@tanstack/react-query";
import {
  applyQueryChange,
  CORE_CHANGE_SCOPE,
  resolveReadChange,
  type ReadChange,
} from "@bb/query-changes";
import { threadStatusChangeMetadataSchema } from "@bb/domain";
import { patchThreadEntity } from "./thread-entity-store";

export function applyCoreReadChange(
  client: QueryClient,
  change: ReadChange,
): Promise<void> {
  if (
    change.entity === "thread" &&
    change.id &&
    change.changes.includes("status-changed") &&
    change.value !== undefined
  ) {
    const reaction = resolveReadChange(undefined, [], change, () => ({
      action: "patch",
      data: threadStatusChangeMetadataSchema.parse(change.value),
    }));
    if (reaction?.action === "patch")
      patchThreadEntity(
        client,
        change.id,
        reaction.data,
        reaction.data.updatedAt,
      );
  }
  return applyQueryChange(client, CORE_CHANGE_SCOPE, change);
}

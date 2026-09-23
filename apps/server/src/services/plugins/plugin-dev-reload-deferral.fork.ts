// bb-fork(windows): hold a builtin plugin's dev hot reload while one of its
// bb-fork(windows): forms is still open. Disposing the plugin interrupts the
// bb-fork(windows): pending request and drops the user's answers, so the rebuild
// bb-fork(windows): and reload wait until the request is answered or expires.
import {
  hasActivePendingInteractionForPlugin,
  type DbConnection,
} from "@bb/db";

export function pluginDevReloadDeferralReason(
  db: DbConnection,
  pluginId: string,
): string | null {
  try {
    return hasActivePendingInteractionForPlugin(db, pluginId)
      ? "a user request is still open"
      : null;
  } catch {
    return null;
  }
}

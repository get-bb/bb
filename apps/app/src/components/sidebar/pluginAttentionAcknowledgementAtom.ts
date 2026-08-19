import { atomWithStorage } from "jotai/utils";
import type { PluginAttentionEntry } from "@bb/server-contract";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const PLUGIN_ATTENTION_ACKNOWLEDGED_STORAGE_KEY =
  "bb.sidebar.pluginAttentionAcknowledged";

/**
 * Stable key for the current set of plugins that need attention. Sorted by id
 * so query order cannot change it; includes status and detail so a plugin
 * that fails differently (or a newly failing plugin) produces a new key.
 */
export function pluginAttentionSnapshotKey(
  plugins: readonly PluginAttentionEntry[],
): string {
  return JSON.stringify(
    [...plugins]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((plugin) => [plugin.id, plugin.status, plugin.statusDetail]),
  );
}

/**
 * Snapshot key the user acknowledged by clicking the sidebar warning glyph.
 * Clicking is an acknowledgement, not a dismiss: the glyph stays hidden only
 * while the attention set is exactly the acknowledged one, and returns on any
 * change. Client-local, like the other sidebar preferences; `null` means
 * nothing is acknowledged.
 */
export const acknowledgedPluginAttentionKeyAtom = atomWithStorage<
  string | null
>(
  PLUGIN_ATTENTION_ACKNOWLEDGED_STORAGE_KEY,
  null,
  createJsonLocalStorage<string | null>(),
  { getOnInit: true },
);

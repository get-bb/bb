import type { PluginInputs } from "@bb/domain";
import type { JsonValue } from "@get-bb/plugin-sdk";

/**
 * The `pluginInputs` a composer will attach to its next submission, written by
 * `useComposer().experimental_setPluginInput` and read once at submit.
 *
 * Module-level and NOT persisted, unlike the draft itself. That is the whole
 * semantic: a plugin input is a statement about the *next* message ("skip
 * routing this once"), so surviving a reload would silently apply a stale
 * choice to a message the user never associated with it. The draft store is
 * localStorage-backed precisely because text should survive; this must not.
 *
 * Keyed by the same composer storage key `setTextEffect` and `setInputLock`
 * use, so a thread draft, a queued-message editor and the new-thread composer
 * each carry their own inputs.
 */
const inputsByStorageKey = new Map<string, Map<string, JsonValue>>();

export function setComposerPluginInput(
  storageKey: string | null,
  pluginId: string,
  input: JsonValue | null,
): void {
  if (storageKey === null) return;
  const existing = inputsByStorageKey.get(storageKey);
  if (input === null) {
    if (existing === undefined) return;
    existing.delete(pluginId);
    if (existing.size === 0) inputsByStorageKey.delete(storageKey);
    return;
  }
  if (existing === undefined) {
    inputsByStorageKey.set(storageKey, new Map([[pluginId, input]]));
    return;
  }
  existing.set(pluginId, input);
}

/** What this composer would send right now, without consuming it. */
export function peekComposerPluginInputs(
  storageKey: string | null,
): PluginInputs | undefined {
  if (storageKey === null) return undefined;
  const existing = inputsByStorageKey.get(storageKey);
  if (existing === undefined || existing.size === 0) return undefined;
  return Object.fromEntries(existing);
}

/**
 * Read this composer's inputs and clear them — the submit-path call.
 *
 * Clearing at read rather than after the request settles is deliberate: the
 * user has committed the message, so the per-message choice is spent. A
 * failed send restores the draft text, not the plugin input, because the
 * plugin control that set it re-renders against the restored draft and can
 * set it again.
 */
export function takeComposerPluginInputs(
  storageKey: string | null,
): PluginInputs | undefined {
  const inputs = peekComposerPluginInputs(storageKey);
  if (storageKey !== null) inputsByStorageKey.delete(storageKey);
  return inputs;
}

/** Drop everything one plugin set, across every composer (unload/disable). */
export function clearComposerPluginInputsForPlugin(pluginId: string): void {
  for (const [storageKey, inputs] of inputsByStorageKey) {
    if (!inputs.delete(pluginId)) continue;
    if (inputs.size === 0) inputsByStorageKey.delete(storageKey);
  }
}

/** Test-only: forget every composer's pending inputs. */
export function resetComposerPluginInputsForTest(): void {
  inputsByStorageKey.clear();
}

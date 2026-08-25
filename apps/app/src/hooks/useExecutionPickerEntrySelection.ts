import { useCallback } from "react";
import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { PluginInputs } from "@bb/domain";
import {
  executionPickerSubmission,
  findExecutionPickerEntry,
  parseExecutionPickerOrderToken,
  type ExecutionPickerValue,
} from "@/components/pickers/execution-picker-selection";
import {
  usePluginSlots,
  type PluginExecutionPickerEntrySlot,
} from "@/lib/plugin-slots";
import { useSystemConfig } from "@/hooks/queries/system-queries";

/**
 * The picker entry the user last chose, remembered as a CLIENT preference and
 * nothing more.
 *
 * localStorage, deliberately — never a project execution default. The plan is
 * explicit that a plugin's routing choice must not be promoted to a project
 * default, and the composer is the only place this selection is allowed to
 * survive. An empty string means "a provider is selected".
 */
const EXECUTION_PICKER_ENTRY_STORAGE_KEY = "bb.promptbox.execution-entry";

const executionEntryTokenAtom = atomWithStorage<string>(
  EXECUTION_PICKER_ENTRY_STORAGE_KEY,
  "",
  undefined,
  { getOnInit: true },
);

/** Surfaces that never offer entries (side chats, plugin pickers) read this. */
const noExecutionEntryAtom = atom("");

export interface ExecutionPickerEntrySelection {
  /** Registered entries, empty when no plugin contributes any. */
  entries: readonly PluginExecutionPickerEntrySlot[];
  /** `providerOrder`, which sorts providers and entries together. */
  order: readonly string[];
  /**
   * The live selection's token, or null. Null both when a provider is
   * selected AND when the remembered entry's plugin is gone — a disabled
   * plugin's entry disappears and the composer falls back to the provider
   * selection without the user having to do anything.
   */
  selectedToken: string | null;
  /** The resolved entry, or null on the same two conditions. */
  selectedEntry: PluginExecutionPickerEntrySlot | null;
  setSelectedToken: (token: string | null) => void;
  /**
   * The `providerId` / `pluginInputs` this selection contributes to a
   * create request. `providerId` is omitted only for a live entry.
   */
  submission: (fallbackProviderId: string) => {
    providerId?: string;
    pluginInputs?: PluginInputs;
  };
}

/**
 * The composer's plugin-entry selection.
 *
 * `enabled: false` yields a permanently empty selection so a surface that
 * cannot honor an entry (no provider omission possible) never shows one.
 */
export function useExecutionPickerEntrySelection(
  enabled: boolean,
): ExecutionPickerEntrySelection {
  const { executionPickerEntries } = usePluginSlots();
  // Only the surfaces that can actually offer an entry subscribe to the
  // config: a composer with entries disabled has no use for `providerOrder`
  // and should not hold a query subscription for it.
  const systemConfig = useSystemConfig({ enabled });
  const [storedToken, setStoredToken] = useAtom(
    enabled ? executionEntryTokenAtom : noExecutionEntryAtom,
  );

  const entries = enabled ? executionPickerEntries : EMPTY_ENTRIES;
  const order = enabled
    ? (systemConfig.data?.generalSettings.providerOrder ?? EMPTY_ORDER)
    : EMPTY_ORDER;

  const parsed: ExecutionPickerValue | null =
    storedToken.length === 0 ? null : parseExecutionPickerOrderToken(storedToken);
  const selectedEntry =
    parsed === null ? null : findExecutionPickerEntry(parsed, entries);
  const selectedToken = selectedEntry === null ? null : storedToken;

  const setSelectedToken = useCallback(
    (token: string | null) => {
      setStoredToken(token ?? "");
    },
    [setStoredToken],
  );

  const submission = useCallback(
    (fallbackProviderId: string) =>
      parsed === null
        ? { providerId: fallbackProviderId }
        : executionPickerSubmission({
            value: parsed,
            entries,
            fallbackProviderId,
          }),
    [entries, parsed],
  );

  return {
    entries,
    order,
    selectedToken,
    selectedEntry,
    setSelectedToken,
    submission,
  };
}

const EMPTY_ENTRIES: readonly PluginExecutionPickerEntrySlot[] = [];
const EMPTY_ORDER: readonly string[] = [];

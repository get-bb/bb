import { atomWithStorage } from "jotai/utils";
import { z } from "zod";
import { createLocalStorageSyncStorage } from "@/lib/browser-storage";

const pluginWorkspaceSchema = z.object({
  tabs: z.array(z.string().min(1)).max(100),
  activePluginId: z.string().nullable(),
});

export type PluginWorkspaceState = z.infer<typeof pluginWorkspaceSchema>;

const storage = createLocalStorageSyncStorage<PluginWorkspaceState>({
  parse: (storedValue, initialValue) => {
    if (storedValue === null) return initialValue;
    try {
      const parsed = pluginWorkspaceSchema.safeParse(JSON.parse(storedValue));
      if (!parsed.success) return initialValue;
      const tabs = [...new Set(parsed.data.tabs)];
      return {
        tabs,
        activePluginId: tabs.includes(parsed.data.activePluginId ?? "")
          ? parsed.data.activePluginId
          : null,
      };
    } catch {
      return initialValue;
    }
  },
  serialize: JSON.stringify,
});

export const pluginWorkspaceAtom = atomWithStorage<PluginWorkspaceState>(
  "bb.plugins.workspace.tabs",
  { tabs: [], activePluginId: null },
  storage,
  { getOnInit: true },
);

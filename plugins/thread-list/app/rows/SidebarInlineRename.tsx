import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  useInlineRename,
  useRenameController,
  useRenameSessionValue,
  type InlineRenameArgs,
  type RenameController,
  type RenameSession,
} from "@/components/ui/inline-rename";
import { InlineRenameEditor } from "@/components/ui/inline-rename-editor";
import { SidebarRenameDialog } from "./SidebarRenameDialog.js";

const SidebarRenameContext = createContext<RenameController | null>(null);

export function SidebarRenameProvider({ children }: { children: ReactNode }) {
  const controller = useRenameController();
  return (
    <SidebarRenameContext.Provider value={controller}>
      {children}
      <SidebarRenameDialog controller={controller} />
    </SidebarRenameContext.Provider>
  );
}

export type SidebarRenameTarget = Pick<RenameSession, "kind" | "id" | "name">;

const IDLE_RENAME_STORE: Pick<RenameController, "subscribe" | "getSession"> = {
  subscribe: () => () => {},
  getSession: () => null,
};

export function useSidebarRenameState(): SidebarRenameTarget | null {
  const store = useContext(SidebarRenameContext) ?? IDLE_RENAME_STORE;
  const kind = useRenameSessionValue(store, (session) => session.kind);
  const id = useRenameSessionValue(store, (session) => session.id);
  const name = useRenameSessionValue(store, (session) => session.name);
  return useMemo(
    () =>
      kind === null || id === null || name === null ? null : { kind, id, name },
    [kind, id, name],
  );
}

export function useSidebarRename(args: InlineRenameArgs) {
  const controller = useContext(SidebarRenameContext);
  if (!controller) {
    throw new Error("useSidebarRename requires a SidebarRenameProvider");
  }
  return useInlineRename(args, { controller, Editor: InlineRenameEditor });
}

import { createContext, useContext, type ReactNode } from "react";
import {
  useInlineRename,
  useRenameController,
  type InlineRenameArgs,
  type RenameController,
} from "@/components/ui/inline-rename";
import { InlineRenameEditor } from "@/components/ui/inline-rename-editor";
import { SidebarRenameDialog } from "./SidebarRenameDialog.js";

const SidebarRenameContext = createContext<RenameController | null>(null);

export function SidebarRenameProvider({ children }: { children: ReactNode }) {
  const controller = useRenameController();
  return (
    <SidebarRenameContext.Provider value={controller}>
      {children}
      <SidebarRenameDialog
        session={controller.session}
        controller={controller}
      />
    </SidebarRenameContext.Provider>
  );
}

export function useSidebarRenameState() {
  return useContext(SidebarRenameContext)?.session ?? null;
}

export function useSidebarRename(args: InlineRenameArgs) {
  const controller = useContext(SidebarRenameContext);
  if (!controller) {
    throw new Error("useSidebarRename requires a SidebarRenameProvider");
  }
  return useInlineRename(args, { controller, Editor: InlineRenameEditor });
}

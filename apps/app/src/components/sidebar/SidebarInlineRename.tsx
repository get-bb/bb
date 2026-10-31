import { createContext, useContext, type ReactNode } from "react";
import {
  useInlineRename,
  type InlineRenameArgs,
  type InlineRenameEditorProps,
  type RenameController,
} from "@bb/shared-ui/inline-rename";
import { RenameSessionDialog } from "@bb/shared-ui/rename-session-dialog";
import { defineSplit } from "@/lib/define-split";

const InlineRenameEditor = defineSplit<InlineRenameEditorProps>({
  id: "sidebar-rename-editor",
  load: () =>
    import("@bb/shared-ui/inline-rename-editor").then(
      (module) => module.InlineRenameEditor,
    ),
  loading: ({ session }) => (
    <span role="status" className="min-w-0 flex-1 truncate">
      {session.name}
    </span>
  ),
  tier: "intent",
});

const RenameControllerContext = createContext<RenameController | null>(null);

export function RenameControllerProvider({
  controller,
  children,
}: {
  controller: RenameController;
  children: ReactNode;
}) {
  return (
    <RenameControllerContext.Provider value={controller}>
      {children}
      <RenameSessionDialog controller={controller} />
    </RenameControllerContext.Provider>
  );
}

export function useSidebarRename(args: InlineRenameArgs) {
  const controller = useContext(RenameControllerContext);
  if (!controller) {
    throw new Error("useSidebarRename requires a RenameControllerProvider");
  }
  return useInlineRename(args, {
    controller,
    Editor: InlineRenameEditor,
    fitEditorToContent: true,
  });
}

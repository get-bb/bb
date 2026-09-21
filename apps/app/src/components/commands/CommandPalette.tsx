import { lazy, Suspense, useMemo, useState } from "react";
import { pluginCommandId } from "@bb/domain";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import {
  useAppCommandHandler,
  useIndexedAppCommandHandlers,
} from "./AppCommandProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { buildPluginPaletteActions } from "@/lib/command-palette/palette-plugin-actions";
import { getActiveThreadPanelOpener } from "@/components/plugin/plugin-thread-panel-navigation";

const CommandPaletteContent = lazy(() =>
  import("./CommandPaletteContent").then((module) => ({
    default: module.CommandPaletteContent,
  })),
);

export interface CommandPaletteProps {
  threadId: string | null;
  projectId: string | null;
}

export interface PaletteOpenRequest {
  mode: "commands" | "threads";
  target: EventTarget | null;
}

export function CommandPalette({ threadId, projectId }: CommandPaletteProps) {
  const [request, setRequest] = useState<PaletteOpenRequest | null>(null);
  const pluginSlots = usePluginSlots();
  const pluginCommandIds = useMemo(
    () =>
      pluginSlots.commandPaletteActions.map((command) =>
        pluginCommandId(command.pluginId, command.id),
      ),
    [pluginSlots.commandPaletteActions],
  );
  useIndexedAppCommandHandlers(pluginCommandIds, (index) => {
    const slot = pluginSlots.commandPaletteActions[index];
    if (!slot) return false;
    const action = buildPluginPaletteActions({
      slots: [slot],
      threadId,
      projectId,
      openThreadPanel: getActiveThreadPanelOpener(),
    })[0];
    if (!action) return false;
    action.run();
    return true;
  });
  useAppCommandHandler("palette.open", ({ target }) => {
    setRequest({ mode: "commands", target: target ?? document.activeElement });
    return true;
  });
  useAppCommandHandler(
    "thread.search",
    ({ target }) => {
      setRequest({ mode: "threads", target: target ?? document.activeElement });
      return true;
    },
    100,
  );

  if (request === null) return null;
  return (
    <Suspense
      fallback={
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setRequest(null);
          }}
        >
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Quick palette</DialogTitle>
            <div role="status" className="text-sm text-muted-foreground">
              Loading…
            </div>
          </DialogContent>
        </Dialog>
      }
    >
      <CommandPaletteContent
        threadId={threadId}
        projectId={projectId}
        request={request}
      />
    </Suspense>
  );
}

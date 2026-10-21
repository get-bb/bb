import { createContext, useContext, useMemo, type ComponentProps } from "react";
import type { PluginThreadAction } from "@get-bb/plugin-sdk";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import { ThreadWorkspaceOpenButton } from "./ThreadWorkspaceOpenButton";

export const CoreWorkspaceHeaderContext = createContext<ComponentProps<
  typeof ThreadWorkspaceOpenButton
> | null>(null);

function WorkspaceHeaderButton() {
  const props = useContext(CoreWorkspaceHeaderContext);
  return props ? <ThreadWorkspaceOpenButton {...props} /> : null;
}

function useWorkspaceOverflowActions(): readonly PluginThreadAction[] {
  const props = useContext(CoreWorkspaceHeaderContext);
  return useMemo(() => {
    if (!props?.preferredTarget) return [];
    const preferred = props.preferredTarget;
    return [
      preferred,
      ...props.targets.filter((target) => target.id !== preferred.id),
    ].map((target) => ({
      icon: "FolderOpen",
      label: `Open workspace in ${target.label}`,
      run: () =>
        target.id === preferred.id
          ? props.onOpenPreferredTarget()
          : props.onOpenTarget(target.id),
    }));
  }, [props]);
}

const coreActions = collectPluginAppRegistrations(
  definePluginApp((app) => {
    app.slots.experimental_threadHeaderAction({
      id: "open-workspace",
      title: "Open workspace",
      component: WorkspaceHeaderButton,
      experimental_useOverflowActions: useWorkspaceOverflowActions,
    });
  }),
).threadHeaderActions.map((slot) => ({
  ...slot,
  pluginId: "core",
  generation: 0,
}));

export function useCoreThreadHeaderActions() {
  const workspace = useContext(CoreWorkspaceHeaderContext);
  return workspace?.preferredTarget ? coreActions : [];
}

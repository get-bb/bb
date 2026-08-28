import { useNavigate } from "react-router-dom";
import { cn } from "@bb/shared-ui/lib/utils";
import { COARSE_POINTER_CHILD_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  usePluginSlots,
  type PluginSidebarFooterActionSlot,
} from "@/lib/plugin-slots";
import { getPluginConfigurationRoutePath } from "@/lib/route-paths";

const SIDEBAR_FOOTER_ACTION_CLASS = cn(
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  "text-muted-foreground hover:text-sidebar-foreground [&>svg]:opacity-80",
);

export function PluginSidebarFooterActions(props: { onNavigate?: () => void }) {
  const { sidebarFooterActions } = usePluginSlots();
  if (sidebarFooterActions.length === 0) return null;
  return (
    <PluginSidebarFooterActionList
      actions={sidebarFooterActions}
      onNavigate={props.onNavigate}
    />
  );
}

function PluginSidebarFooterActionList({
  actions,
  onNavigate,
}: {
  actions: readonly PluginSidebarFooterActionSlot[];
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <>
      {actions.map((action) => (
        <SidebarMenuItem
          key={`${action.pluginId}/${action.id}/${action.generation}`}
          className="min-w-0"
        >
          <SidebarMenuButton
            className={SIDEBAR_FOOTER_ACTION_CLASS}
            tooltip={{
              children: action.title,
              hidden: false,
              side: "top",
            }}
            aria-label={action.title}
            data-testid={`plugin-sidebar-footer-action-${action.pluginId}-${action.id}`}
            onClick={() => {
              onNavigate?.();
              runSidebarFooterAction({
                action,
                navigate,
              });
            }}
          >
            <PluginIcon pluginId={action.pluginId} icon={action.icon} />
            <span className="sr-only">{action.title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </>
  );
}

function runSidebarFooterAction({
  action,
  navigate,
}: {
  action: PluginSidebarFooterActionSlot;
  navigate: ReturnType<typeof useNavigate>;
}): void {
  const openSettings = () => {
    void navigate(
      getPluginConfigurationRoutePath({ pluginId: action.pluginId }),
    );
  };
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${action.pluginId}] sidebarFooterAction "${action.id}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  };
  try {
    const result = action.run({ openSettings });
    if (result instanceof Promise) result.catch(warn);
  } catch (error) {
    warn(error);
  }
}

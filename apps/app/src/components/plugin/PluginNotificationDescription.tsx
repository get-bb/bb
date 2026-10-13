import { useCallback, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { appToast, type AppToastOptions } from "@/components/ui/app-toast";
import {
  getPluginDetailRoutePath,
  getPluginPanelRoutePath,
} from "@/lib/route-paths";
import { getPluginSlotSnapshot, usePluginSlots } from "@/lib/plugin-slots";

function PluginOpenActionLabel({ pluginId }: { pluginId: string }) {
  const slots = usePluginSlots();
  return slots.navPanels.some((panel) => panel.pluginId === pluginId)
    ? "Open plugin"
    : "View details";
}

export function usePluginNotificationAction() {
  const navigate = useNavigate();
  return useCallback(
    (
      pluginId: string,
      destination: "app" | "installed" | "catalog",
    ): NonNullable<AppToastOptions["action"]> => ({
      label:
        destination === "app" ? (
          <PluginOpenActionLabel pluginId={pluginId} />
        ) : (
          "Details"
        ),
      onClick: () => {
        const panel =
          destination === "app"
            ? getPluginSlotSnapshot().navPanels.find(
                (panel) => panel.pluginId === pluginId,
              )
            : undefined;
        navigate(
          panel
            ? getPluginPanelRoutePath({ pluginId, path: panel.path })
            : getPluginDetailRoutePath({
                pluginId,
                ...(destination === "catalog" ? {} : { view: "installed" }),
              }),
        );
      },
    }),
    [navigate],
  );
}

interface PluginNotificationTarget {
  id: string;
  name: string | null;
}

type PluginView = "catalog" | "installed";

export function pluginNotificationDescription(
  plugin: PluginNotificationTarget,
  view: PluginView,
  detail?: ReactNode,
): ReactNode {
  return (
    <>
      <Link
        to={getPluginDetailRoutePath({
          pluginId: plugin.id,
          ...(view === "installed" ? { view } : {}),
        })}
        className="rounded-sm underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {plugin.name ?? plugin.id}
      </Link>
      {detail === undefined ? null : <> — {detail}</>}
    </>
  );
}

function createPluginToast(tone: "error" | "message" | "success") {
  return (
    title: ReactNode,
    plugin: PluginNotificationTarget,
    view: PluginView,
    detail?: ReactNode,
  ) =>
    appToast[tone](title, {
      description: pluginNotificationDescription(plugin, view, detail),
    });
}

export const pluginToast = {
  error: createPluginToast("error"),
  message: createPluginToast("message"),
  success: createPluginToast("success"),
};

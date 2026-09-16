import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import { useNavigate } from "react-router-dom";
import { appToast } from "@/components/ui/app-toast";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import { searchPluginCatalog } from "@/hooks/queries/plugin-catalog-queries";
import {
  pluginListQueryOptions,
  setPluginEnabled,
} from "@/hooks/queries/plugin-settings-queries";
import { pluginAdminErrorMessage } from "@/lib/plugin-admin-error";
import { AddPluginDialog, type AddPluginInitial } from "./AddPluginDialog";

const PLUGIN_GUIDE_ID = "plugin-api-docs";
const PLUGIN_GUIDE_PATH = `/plugins/${PLUGIN_GUIDE_ID}/plugin-api`;

export function OpenPluginGuideButton() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [installTarget, setInstallTarget] = useState<AddPluginInitial | null>(
    null,
  );
  const open = useMutation({
    meta: { showErrorToast: false },
    mutationFn: async () => {
      const plugins = await queryClient.fetchQuery({
        ...pluginListQueryOptions({ enabled: true }),
        staleTime: 0,
      });
      const guide = plugins.find((plugin) => plugin.id === PLUGIN_GUIDE_ID);
      if (guide === undefined) {
        const catalog = await searchPluginCatalog(fetch, PLUGIN_GUIDE_ID);
        const entry = catalog.entries.find(
          (candidate) =>
            candidate.pluginId === PLUGIN_GUIDE_ID &&
            candidate.source === `builtin:${PLUGIN_GUIDE_ID}` &&
            candidate.official,
        );
        if (entry === undefined) {
          throw new Error("Plugin Guide is unavailable in the catalog.");
        }
        return entry;
      }
      if (!guide.enabled) {
        await setPluginEnabled(fetch, PLUGIN_GUIDE_ID, true);
        await invalidatePluginList({ queryClient });
      }
      return null;
    },
    onError: (error) => {
      appToast.error("Could not open Plugin Guide", {
        description: pluginAdminErrorMessage(error),
      });
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="shrink-0 gap-1.5 px-0 text-muted-foreground hover:text-foreground"
        disabled={open.isPending}
        aria-busy={open.isPending}
        onClick={() =>
          open.mutate(undefined, {
            onSuccess: (initial) => {
              if (initial === null) navigate(PLUGIN_GUIDE_PATH);
              else setInstallTarget(initial);
            },
          })
        }
      >
        <Icon
          name={open.isPending ? "Spinner" : "Explore"}
          className={cn("size-4", open.isPending && "animate-spin")}
          aria-hidden
        />
        <span className="underline underline-offset-4">Plugin Guide</span>
      </Button>
      <AddPluginDialog
        open={installTarget !== null}
        initial={installTarget}
        onOpenChange={(isOpen) => {
          if (!isOpen) setInstallTarget(null);
        }}
        onInstalled={() => navigate(PLUGIN_GUIDE_PATH)}
      />
    </>
  );
}

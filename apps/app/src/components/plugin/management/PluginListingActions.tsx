import { useNavigate } from "react-router-dom";
import type { PluginListingRecord } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  pluginListingActionLabel,
  pluginListingTaskPrompt,
} from "@/hooks/queries/plugin-listing-queries";
import { getRootComposeRoutePath } from "@/lib/route-paths";

interface PluginListingActionsProps {
  record: PluginListingRecord;
}

export function PluginListingActions({ record }: PluginListingActionsProps) {
  const navigate = useNavigate();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        navigate(getRootComposeRoutePath(), {
          state: {
            focusPrompt: true,
            initialPrompt: pluginListingTaskPrompt(record),
            replaceInitialPrompt: true,
          },
        })
      }
    >
      {pluginListingActionLabel(record)}
    </Button>
  );
}

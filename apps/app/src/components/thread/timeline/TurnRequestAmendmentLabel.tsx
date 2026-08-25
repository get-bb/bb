import type { TimelineConversationTurnRequestAmendment } from "@bb/server-contract";
import { Icon } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";

interface TurnRequestAmendmentLabelProps {
  amendment: TimelineConversationTurnRequestAmendment;
}

/**
 * Provenance for a turn a dispatch gate rewrote: who chose this execution.
 * The caller renders this only when the row carries an amendment, so the
 * plugin list is fetched on amended turns alone — an install with no gates
 * never mounts this and shows no extra chrome.
 *
 * The plugin list resolves the display name; a plugin uninstalled since the
 * turn ran is not in it, so the id stands in rather than disappearing.
 */
export function TurnRequestAmendmentLabel({
  amendment,
}: TurnRequestAmendmentLabelProps) {
  const pluginListQuery = usePluginList({ enabled: true });
  const plugin = pluginListQuery.data?.plugins.find(
    (entry) => entry.id === amendment.pluginId,
  );
  const pluginName = plugin?.name ?? amendment.pluginId;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="shrink-0 whitespace-nowrap text-xs leading-none text-subtle-foreground"
          >
            <Icon
              name="Puzzle"
              className="mr-1 inline-block size-3 align-middle"
            />
            {`Chosen by ${pluginName}`}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {`${pluginName} amended this turn's execution. Model: ${amendment.model}.`}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

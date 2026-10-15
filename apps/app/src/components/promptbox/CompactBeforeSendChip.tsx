import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
} from "@bb/shared-ui/option-display";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { formatCompactTokenCount } from "@/components/thread/timeline/thread-context-window-usage";

export interface CompactBeforeSendOffer {
  compactFirst: boolean;
  onToggle: () => void;
  tokens: number;
}

export function CompactBeforeSendChip({
  compactFirst,
  onToggle,
  tokens,
}: CompactBeforeSendOffer) {
  const tokensLabel = formatCompactTokenCount(tokens);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={compactFirst}
            aria-label={`Compact ${tokensLabel} tokens of history before sending`}
            onClick={onToggle}
            className={cn(
              OPTION_BASE_CLASS_NAME,
              OPTION_INTERACTIVE_CLASS_NAME,
              LIST_HOVER_TRANSITION,
              "h-6 tabular-nums max-md:pointer-coarse:h-11 max-md:pointer-coarse:px-2",
              compactFirst
                ? "text-warning-text hover:text-warning-text aria-pressed:bg-transparent aria-pressed:text-warning-text aria-pressed:hover:bg-state-hover"
                : OPTION_MUTED_CLASS_NAME,
            )}
          >
            <Icon name="Minimize2" className="size-3.5" aria-hidden />
            {compactFirst ? "Compact" : "Full"} {tokensLabel}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {compactFirst
            ? `The prompt cache expired. The next send compacts ${tokensLabel} tokens first. Click to keep full history`
            : `The next send keeps all ${tokensLabel} tokens. Click to compact first`}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

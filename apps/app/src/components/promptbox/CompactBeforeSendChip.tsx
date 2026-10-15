import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
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
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={compactFirst}
            aria-label={
              compactFirst
                ? `Compact ${tokensLabel} tokens before sending`
                : `Keep all ${tokensLabel} tokens of history`
            }
            onMouseDown={(event) => event.preventDefault()}
            onClick={onToggle}
            className={cn(
              COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
              "gap-1.5 rounded-full border text-xs tabular-nums [&_[data-icon-root]]:size-3.5",
              compactFirst
                ? "border-warning/20 bg-warning/5 text-warning-text hover:bg-warning/10 hover:text-warning-text aria-pressed:bg-warning/5 aria-pressed:text-warning-text aria-pressed:hover:bg-warning/10"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon
              name="Minimize2"
              className="max-md:pointer-coarse:hidden"
              aria-hidden
            />
            {compactFirst ? (
              <span>
                Compact
                <span className="max-md:pointer-coarse:hidden">
                  {` ${tokensLabel}`}
                </span>
              </span>
            ) : (
              "Keep history"
            )}
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

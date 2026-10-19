import { Button } from "@bb/shared-ui/button";
import {
  COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
  COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { OptionPicker } from "@/components/pickers/OptionPicker";
import { formatCompactTokenCount } from "@/components/thread/timeline/thread-context-window-usage";

export interface CompactBeforeSendOffer {
  compactFirst: boolean;
  onCompactFirstChange: (compactFirst: boolean) => void;
  tokens: number;
}

type CompactBeforeSendChoice = "compact" | "keep";

const PILL_CLASS = "rounded-full border text-xs tabular-nums";
const COMPACT_TONE_CLASS =
  "border-warning/20 bg-warning/5 text-warning-text hover:bg-warning/10 hover:text-warning-text aria-pressed:bg-warning/5 aria-pressed:text-warning-text aria-pressed:hover:bg-warning/10 data-[state=open]:bg-warning/10 data-[state=open]:text-warning-text";
const KEEP_TONE_CLASS =
  "border-border text-muted-foreground hover:bg-state-hover hover:text-foreground";

export function CompactBeforeSendChip(offer: CompactBeforeSendOffer) {
  const isCompactViewport = useIsCompactViewport();
  return isCompactViewport ? (
    <CompactBeforeSendPicker {...offer} />
  ) : (
    <CompactBeforeSendToggle {...offer} />
  );
}

function CompactBeforeSendToggle({
  compactFirst,
  onCompactFirstChange,
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
            onClick={() => onCompactFirstChange(!compactFirst)}
            className={cn(
              COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
              PILL_CLASS,
              "gap-1.5 [&_[data-icon-root]]:size-3.5",
              compactFirst ? COMPACT_TONE_CLASS : KEEP_TONE_CLASS,
            )}
          >
            <Icon name="CircleArrowShrink" aria-hidden />
            {compactFirst ? `Compact ${tokensLabel}` : "Keep history"}
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

function CompactBeforeSendPicker({
  compactFirst,
  onCompactFirstChange,
  tokens,
}: CompactBeforeSendOffer) {
  const tokensLabel = formatCompactTokenCount(tokens);
  return (
    <OptionPicker<CompactBeforeSendChoice>
      label="Prompt cache expired"
      notice={
        <div className="mx-1 mb-1.5 flex items-start gap-2 rounded-md border border-warning/20 bg-warning/5 px-2.5 py-2 text-xs leading-snug text-warning-text">
          <Icon
            name="CircleArrowShrink"
            className="mt-px size-3.5 shrink-0"
            aria-hidden
          />
          <span>{`This thread sat idle past its prompt cache, so your next message re-processes all ${tokensLabel} tokens, which is slower and costs more.`}</span>
        </div>
      }
      value={compactFirst ? "compact" : "keep"}
      align="end"
      onChange={(choice) => onCompactFirstChange(choice === "compact")}
      options={[
        {
          value: "compact",
          label: "Compact first",
          description: "Summarize the history, then send.",
        },
        {
          value: "keep",
          label: "Keep full history",
          description: `Send with all ${tokensLabel} tokens.`,
        },
      ]}
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(event) =>
            event.currentTarget.focus({ preventScroll: true })
          }
          aria-label={
            compactFirst
              ? `Prompt cache expired: compacting ${tokensLabel} tokens before sending`
              : `Prompt cache expired: keeping all ${tokensLabel} tokens`
          }
          className={cn(
            COARSE_POINTER_PROMPT_ICON_ACTION_BUTTON_CLASS,
            compactFirst
              ? "text-warning-text hover:text-warning-text data-[state=open]:text-warning-text"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon name="CircleArrowShrink" className="size-4" aria-hidden />
        </Button>
      }
    />
  );
}

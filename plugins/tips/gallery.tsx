import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { TipView } from "./contract.js";
import { describeTipAction } from "./actions.js";
import { TipArt, TipArtStyles } from "./illustrations.js";

export interface TipsGalleryProps {
  tips: readonly TipView[];
  filledId: string | null;
  notice: string | null;
  onPreview(id: string | null): void;
  onActivate(tip: TipView): void;
  onDismiss(): void;
}

const FEED_FADE =
  "linear-gradient(to bottom, black calc(100% - 64px), rgb(0 0 0 / 0.4))";

const FEED_CSS = `
.tips-feed { -webkit-mask-image: ${FEED_FADE}; mask-image: ${FEED_FADE}; }
.tips-feed:has(> li:last-child :is(:hover, :focus-visible)) {
  -webkit-mask-image: none;
  mask-image: none;
}
`;

function DismissTips({ onDismiss }: Pick<TipsGalleryProps, "onDismiss">) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-muted-foreground"
            onClick={onDismiss}
          >
            Hide tips
            <Icon name="X" className="size-3.5" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          Turns tips off. Turn them back on with Show tips in the Tips plugin
          settings.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function TipsFeed({
  tips,
  filledId,
  onPreview,
  onActivate,
}: Pick<TipsGalleryProps, "tips" | "filledId" | "onPreview" | "onActivate">) {
  return (
    <>
      <TipArtStyles />
      <style>{FEED_CSS}</style>
      <ul className="tips-feed overflow-hidden rounded-xl border border-border-hairline bg-background shadow-xs">
        {tips.map((tip) => (
          <li
            key={tip.id}
            className="border-b border-border-hairline last:border-b-0"
          >
            <button
              type="button"
              data-tip-id={tip.id}
              data-tip-art-trigger=""
              className={cn(
                "flex w-full items-center gap-4 px-4 py-3 text-left outline-none motion-safe:transition-colors hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                filledId === tip.id && "bg-surface-selected",
              )}
              onMouseEnter={() => onPreview(tip.id)}
              onMouseLeave={() => onPreview(null)}
              onFocus={() => onPreview(tip.id)}
              onBlur={() => onPreview(null)}
              onClick={() => onActivate(tip)}
            >
              <TipArt illustration={tip.illustration} tone={tip.tone} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  {tip.title}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {tip.body}
                </span>
                <span className="sr-only">{describeTipAction(tip.action)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function TipsGallery({
  tips,
  filledId,
  notice,
  onPreview,
  onActivate,
  onDismiss,
}: TipsGalleryProps) {
  return (
    <section aria-label="Tips" className="mt-20 flex flex-col gap-1.5">
      <div className="flex justify-end">
        <DismissTips onDismiss={onDismiss} />
      </div>
      <TipsFeed
        tips={tips}
        filledId={filledId}
        onPreview={onPreview}
        onActivate={onActivate}
      />
      <p role="status" className="min-h-4 text-xs text-muted-foreground">
        {notice ?? ""}
      </p>
    </section>
  );
}

export function TipsHiddenNotice({ onUndo }: { onUndo: () => void }) {
  return (
    <p role="status" className="mt-20 text-xs text-muted-foreground">
      Tips are off. Turn them back on anytime with Show tips in the Tips plugin
      settings.{" "}
      <button
        type="button"
        className="underline underline-offset-2 hover:text-foreground"
        onClick={onUndo}
      >
        Undo
      </button>
    </p>
  );
}

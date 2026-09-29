import { useId } from "react";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import { defineSplit, SplitLoadFailure } from "@/lib/define-split";
import type { CommandPaletteBodyProps } from "./CommandPaletteBody";
import {
  COMMAND_PALETTE_INPUT,
  PALETTE_INPUT_CLASS,
  PaletteInputBand,
} from "./PaletteInputBand";

const SKELETON_ROW_WIDTHS = [
  "w-1/3",
  "w-2/5",
  "w-1/4",
  "w-1/3",
  "w-1/2",
  "w-2/5",
  "w-1/4",
  "w-1/3",
  "w-2/5",
  "w-1/4",
  "w-1/2",
  "w-1/3",
];

function CommandPaletteBodyPlaceholder({
  query,
  onQueryChange,
  retry,
}: CommandPaletteBodyProps & { retry?: () => void }) {
  const descriptionId = useId();
  return (
    <>
      <PaletteInputBand>
        <input
          autoFocus
          aria-label={COMMAND_PALETTE_INPUT.label}
          aria-describedby={descriptionId}
          autoComplete="off"
          spellCheck={false}
          className={PALETTE_INPUT_CLASS}
          placeholder={COMMAND_PALETTE_INPUT.placeholder}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <span id={descriptionId} className="sr-only">
          {COMMAND_PALETTE_INPUT.description}
        </span>
      </PaletteInputBand>
      <div className="rounded-b-[inherit] bg-background">
        {retry ? (
          <SplitLoadFailure retry={retry} />
        ) : (
          <div
            role="status"
            aria-label="Loading commands"
            className="h-[min(24rem,50dvh)] overflow-hidden p-1"
          >
            {SKELETON_ROW_WIDTHS.map((width, index) => (
              <div key={index} className="flex h-8 items-center px-2">
                <Skeleton className={cn("h-3 rounded-sm", width)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export const LazyCommandPaletteBody = defineSplit<CommandPaletteBodyProps>({
  id: "command-palette-body",
  load: () =>
    import("./CommandPaletteBody").then((module) => module.CommandPaletteBody),
  loading: CommandPaletteBodyPlaceholder,
  error: CommandPaletteBodyPlaceholder,
  preload: "render",
});

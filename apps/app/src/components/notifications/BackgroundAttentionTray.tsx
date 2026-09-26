import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ThreadPendingInteractionAttentionEntry } from "@bb/server-contract";
import { Icon } from "@bb/shared-ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { useHiddenThreadPendingInteractionAttention } from "@/hooks/queries/pending-interaction-attention";

interface BackgroundAttentionTrayProps {
  currentThreadId: string | null;
}

type BackgroundAttentionTrayListModule =
  typeof import("./BackgroundAttentionTrayList");

const EMPTY_ENTRIES: readonly ThreadPendingInteractionAttentionEntry[] = [];

let backgroundAttentionTrayListModulePromise: Promise<BackgroundAttentionTrayListModule> | null =
  null;

function loadBackgroundAttentionTrayList(): Promise<BackgroundAttentionTrayListModule> {
  backgroundAttentionTrayListModulePromise ??=
    import("./BackgroundAttentionTrayList");
  return backgroundAttentionTrayListModulePromise;
}

function preloadBackgroundAttentionTrayList(): void {
  void loadBackgroundAttentionTrayList().catch(() => {
    backgroundAttentionTrayListModulePromise = null;
  });
}

const BackgroundAttentionTrayListChunk = lazy(() =>
  loadBackgroundAttentionTrayList().then(({ BackgroundAttentionTrayList }) => ({
    default: BackgroundAttentionTrayList,
  })),
);

export function selectBackgroundAttentionEntries(
  entries: readonly ThreadPendingInteractionAttentionEntry[],
  currentThreadId: string | null,
): readonly ThreadPendingInteractionAttentionEntry[] {
  return currentThreadId === null
    ? entries
    : entries.filter((entry) => entry.thread.id !== currentThreadId);
}

export function backgroundAttentionLabel(count: number): string {
  return count === 1
    ? "1 background thread needs you"
    : `${count} background threads need you`;
}

export function useBackgroundAttentionEntries(
  currentThreadId: string | null,
): readonly ThreadPendingInteractionAttentionEntry[] {
  const { data } = useHiddenThreadPendingInteractionAttention();
  return useMemo(
    () =>
      selectBackgroundAttentionEntries(data ?? EMPTY_ENTRIES, currentThreadId),
    [currentThreadId, data],
  );
}

export function BackgroundAttentionTray({
  currentThreadId,
}: BackgroundAttentionTrayProps) {
  const entries = useBackgroundAttentionEntries(currentThreadId);
  const [open, setOpen] = useState(false);
  const hasEntries = entries.length > 0;

  useEffect(() => {
    if (hasEntries) {
      preloadBackgroundAttentionTrayList();
    }
  }, [hasEntries]);

  if (!hasEntries) {
    return null;
  }

  const label = backgroundAttentionLabel(entries.length);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="background-attention-trigger"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full border border-border bg-popover px-3 py-1.5 text-xs font-medium text-foreground shadow-md transition-colors hover:bg-accent"
        >
          <Icon name="CircleQuestion" className="size-3.5" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        dismissOnOutsideInteraction={false}
        side="top"
        align="end"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        mobileTitle="Waiting on you"
        aria-label="Background threads waiting on you"
        data-testid="background-attention-tray"
        className="w-[28rem] max-w-[calc(100vw-2rem)] p-0"
        mobileClassName="p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="text-sm font-medium leading-5">Waiting on you</div>
          <button
            type="button"
            aria-label="Hide background threads"
            className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            <Icon name="X" className="size-3.5" />
          </button>
        </div>
        <div className="flex max-h-[min(60vh,32rem)] flex-col gap-2 overflow-y-auto p-2">
          <Suspense
            fallback={
              <span
                role="status"
                className="px-1 py-2 text-xs text-muted-foreground"
              >
                Loading…
              </span>
            }
          >
            <BackgroundAttentionTrayListChunk entries={entries} />
          </Suspense>
        </div>
      </PopoverContent>
    </Popover>
  );
}

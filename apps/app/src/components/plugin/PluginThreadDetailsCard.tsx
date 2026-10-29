import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useAtom } from "jotai";
import type { ExperimentalThreadDetailsCardProps } from "@get-bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import { INFO_SECTION_TITLE_CLASS } from "@/components/secondary-panel/info/info-list";
import {
  compareGroupedPlacement,
  type GroupedPlacement,
} from "@/lib/grouped-placement";
import {
  usePluginSlots,
  type PluginThreadDetailsCardRowSlot,
  type PluginThreadDetailsCardSectionSlot,
} from "@/lib/plugin-slots";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import { PluginSlotMount } from "./PluginSlotMount";

export interface CoreThreadDetailsCardRow {
  id: string;
  group: string;
  order: number;
  component: ComponentType<ExperimentalThreadDetailsCardProps>;
}

export interface CoreThreadDetailsCardSection {
  id: string;
  title: string;
  group: string;
  order: number;
  component: ComponentType<ExperimentalThreadDetailsCardProps>;
}

type ThreadDetailsCardSectionEntry =
  | { owner: "core"; slot: CoreThreadDetailsCardSection }
  | { owner: "plugin"; slot: PluginThreadDetailsCardSectionSlot };

type ThreadDetailsCardRowEntry =
  | { owner: "core"; slot: CoreThreadDetailsCardRow }
  | { owner: "plugin"; slot: PluginThreadDetailsCardRowSlot };

export type ThreadDetailsCardLayout = "gutter" | "shift" | "overlay";

const TRANSCRIPT_MAX_WIDTH_PX = 760;
const CARD_WIDTH_PX = 288;
export const THREAD_DETAILS_CARD_RESERVED_WIDTH_PX = CARD_WIDTH_PX + 24;

export function resolveThreadDetailsCardLayout(
  paneWidth: number,
): ThreadDetailsCardLayout {
  const gutter = (paneWidth - TRANSCRIPT_MAX_WIDTH_PX) / 2;
  if (gutter >= THREAD_DETAILS_CARD_RESERVED_WIDTH_PX) return "gutter";
  if (
    paneWidth - THREAD_DETAILS_CARD_RESERVED_WIDTH_PX >=
    TRANSCRIPT_MAX_WIDTH_PX
  )
    return "shift";
  return "overlay";
}

const pinnedAtom = createSyncedPreferenceAtom("threadDetailsCard.pinned");

interface ThreadDetailsCardPaneState {
  props: ExperimentalThreadDetailsCardProps;
  rows: readonly ThreadDetailsCardRowEntry[];
  sections: readonly ThreadDetailsCardSectionEntry[];
  layout: ThreadDetailsCardLayout;
  setLayout(layout: ThreadDetailsCardLayout): void;
  popoverOpen: boolean;
  setPopoverOpen(open: boolean): void;
}

const ThreadDetailsCardPaneContext =
  createContext<ThreadDetailsCardPaneState | null>(null);

function sortByPlacement<Item>(
  items: readonly Item[],
  placement: (item: Item) => GroupedPlacement,
): Item[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) =>
      compareGroupedPlacement(
        placement(left.item),
        left.index,
        placement(right.item),
        right.index,
      ),
    )
    .map(({ item }) => item);
}

export function ThreadDetailsCardProvider({
  enabled,
  coreRows,
  coreSections,
  threadId,
  projectId,
  environment,
  children,
}: ExperimentalThreadDetailsCardProps & {
  enabled: boolean;
  coreRows: readonly CoreThreadDetailsCardRow[];
  coreSections: readonly CoreThreadDetailsCardSection[];
  children: ReactNode;
}) {
  const { threadDetailsCardRows, threadDetailsCardSections } = usePluginSlots();
  const [layout, setLayout] = useState<ThreadDetailsCardLayout>("overlay");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const environmentId = environment?.id ?? null;
  const value = useMemo<ThreadDetailsCardPaneState>(
    () => ({
      props: {
        threadId,
        projectId,
        environment: environmentId === null ? null : { id: environmentId },
      },
      rows: enabled
        ? sortByPlacement<ThreadDetailsCardRowEntry>(
            [
              ...coreRows.map((slot) => ({ owner: "core" as const, slot })),
              ...threadDetailsCardRows.map((slot) => ({
                owner: "plugin" as const,
                slot,
              })),
            ],
            (entry) => entry.slot,
          )
        : [],
      sections: enabled
        ? sortByPlacement<ThreadDetailsCardSectionEntry>(
            [
              ...coreSections.map((slot) => ({ owner: "core" as const, slot })),
              ...threadDetailsCardSections.map((slot) => ({
                owner: "plugin" as const,
                slot,
              })),
            ],
            (entry) => entry.slot,
          )
        : [],
      layout,
      setLayout,
      popoverOpen,
      setPopoverOpen,
    }),
    [
      coreRows,
      coreSections,
      enabled,
      environmentId,
      layout,
      popoverOpen,
      projectId,
      threadDetailsCardRows,
      threadDetailsCardSections,
      threadId,
    ],
  );
  return (
    <ThreadDetailsCardPaneContext.Provider value={value}>
      {children}
    </ThreadDetailsCardPaneContext.Provider>
  );
}

function usePaneState(): ThreadDetailsCardPaneState | null {
  const state = useContext(ThreadDetailsCardPaneContext);
  return state !== null && state.rows.length + state.sections.length > 0
    ? state
    : null;
}

export function useThreadDetailsCardShown(): boolean {
  return usePaneState() !== null;
}

export function useThreadDetailsCardContentInset(): number {
  const state = usePaneState();
  const [pinned] = useAtom(pinnedAtom);
  return state !== null && pinned && state.layout === "shift"
    ? THREAD_DETAILS_CARD_RESERVED_WIDTH_PX
    : 0;
}

const EMPTY_BLOCK_CLASS =
  "[&:not(:has([data-thread-details-card-body]_:not([data-bb-plugin-root])))]:hidden";

const SECTION_DIVIDER_CLASS =
  "[:is([data-thread-details-card-rows],[data-thread-details-card-section]):has([data-thread-details-card-body]_:not([data-bb-plugin-root]))~&]:mt-2 [:is([data-thread-details-card-rows],[data-thread-details-card-section]):has([data-thread-details-card-body]_:not([data-bb-plugin-root]))~&]:border-t [:is([data-thread-details-card-rows],[data-thread-details-card-section]):has([data-thread-details-card-body]_:not([data-bb-plugin-root]))~&]:border-border [:is([data-thread-details-card-rows],[data-thread-details-card-section]):has([data-thread-details-card-body]_:not([data-bb-plugin-root]))~&]:pt-2";

const SHOW_EMPTY_STATE_CLASS =
  "contents [&:not(:has([data-thread-details-card-body]_:not([data-bb-plugin-root])))>[data-thread-details-card-empty]]:flex";

function ThreadDetailsCardContent({
  state,
}: {
  state: ThreadDetailsCardPaneState;
}) {
  const { props } = state;
  return (
    <div className={SHOW_EMPTY_STATE_CLASS}>
      {state.rows.length > 0 ? (
        <div data-thread-details-card-rows="" className={EMPTY_BLOCK_CLASS}>
          <div data-thread-details-card-body="" className="contents">
            {state.rows.map((entry) => {
              const Component = entry.slot.component;
              if (entry.owner === "core") {
                return <Component key={`core/${entry.slot.id}`} {...props} />;
              }
              const { pluginId, id, generation } = entry.slot;
              return (
                <PluginSlotMount
                  key={`${pluginId}/${id}/${generation}/${props.threadId}`}
                  pluginId={pluginId}
                  slotKind="threadDetailsCardRow"
                  slotId={id}
                  instanceId={props.threadId}
                  crashResetKey={String(generation)}
                  crashFallback={null}
                >
                  <Component {...props} />
                </PluginSlotMount>
              );
            })}
          </div>
        </div>
      ) : null}
      {state.sections.map((entry) => {
        const Component = entry.slot.component;
        const key =
          entry.owner === "core"
            ? `core/${entry.slot.id}`
            : `${entry.slot.pluginId}/${entry.slot.id}/${entry.slot.generation}/${props.threadId}`;
        return (
          <section
            key={key}
            data-thread-details-card-section=""
            aria-label={entry.slot.title}
            className={cn(SECTION_DIVIDER_CLASS, EMPTY_BLOCK_CLASS)}
          >
            <div className="mb-0.5 flex min-h-5 items-center px-2">
              <h3 className={INFO_SECTION_TITLE_CLASS}>
                <span className="truncate">{entry.slot.title}</span>
              </h3>
            </div>
            <div data-thread-details-card-body="" className="contents">
              {entry.owner === "core" ? (
                <Component {...props} />
              ) : (
                <PluginSlotMount
                  pluginId={entry.slot.pluginId}
                  slotKind="threadDetailsCardSection"
                  slotId={entry.slot.id}
                  instanceId={props.threadId}
                  crashResetKey={String(entry.slot.generation)}
                  crashFallback={null}
                >
                  <Component {...props} />
                </PluginSlotMount>
              )}
            </div>
          </section>
        );
      })}
      <div
        data-thread-details-card-empty=""
        className="hidden flex-col gap-0.5 px-2 py-1.5 text-xs"
      >
        <span className="text-muted-foreground">Nothing to show yet</span>
        <span className="text-subtle-foreground">
          Changes, pull requests, and related threads show up here.
        </span>
      </div>
    </div>
  );
}

const CARD_CLASS =
  "overflow-y-auto overflow-x-hidden rounded-2xl border border-border bg-popover p-2 text-popover-foreground";

export function ThreadDetailsCard() {
  const state = usePaneState();
  const [pinned] = useAtom(pinnedAtom);
  const probeRef = useRef<HTMLSpanElement>(null);
  const setLayout = state?.setLayout;

  useLayoutEffect(() => {
    const overlay = probeRef.current?.closest<HTMLElement>(
      "[data-scroll-overlay]",
    );
    if (!overlay || !setLayout) return;
    const measure = () =>
      setLayout(resolveThreadDetailsCardLayout(overlay.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(overlay);
    return () => observer.disconnect();
  }, [setLayout]);

  if (state === null) return null;
  return (
    <>
      <span ref={probeRef} aria-hidden className="hidden" />
      {pinned && state.layout !== "overlay" ? (
        <div
          role="group"
          aria-label="Thread details"
          data-thread-details-card=""
          className={cn(
            "pointer-events-auto max-h-[min(36rem,calc(100%-1.5rem))] w-72 shrink-0",
            CARD_CLASS,
          )}
        >
          <ThreadDetailsCardContent state={state} />
        </div>
      ) : null}
    </>
  );
}

const HEADER_BUTTON_CLASS = cn(
  HEADER_ICON_BUTTON_CLASS,
  CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
  "rounded-md p-0 aria-pressed:bg-transparent aria-pressed:text-subtle-foreground/75 aria-pressed:hover:bg-state-hover aria-pressed:hover:text-muted-foreground",
);

export function ThreadDetailsCardHeaderButton() {
  const state = usePaneState();
  const [pinned, setPinned] = useAtom(pinnedAtom);
  if (state === null) return null;
  if (state.layout !== "overlay") {
    const label = pinned ? "Unpin thread details" : "Pin thread details";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={pinned}
            className={HEADER_BUTTON_CLASS}
            onClick={() => setPinned(!pinned)}
          >
            <Icon name="LayoutList" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Popover open={state.popoverOpen} onOpenChange={state.setPopoverOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Thread details"
              className={HEADER_BUTTON_CLASS}
            >
              <Icon name="LayoutList" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Thread details</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        mobileTitle="Thread details"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="max-h-[min(36rem,calc(100dvh-6rem))] w-72 overflow-y-auto p-0"
      >
        <div
          role="group"
          aria-label="Thread details"
          data-thread-details-card=""
          className="overflow-hidden p-2"
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("button[data-thread-details-card-row]")
            ) {
              state.setPopoverOpen(false);
            }
          }}
        >
          <ThreadDetailsCardContent state={state} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useAtom } from "jotai";
import type { ExperimentalThreadContextCardProps } from "@get-bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { observeSharedResize } from "@bb/shared-ui/lib/shared-resize-observer";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import {
  compareGroupedPlacement,
  type GroupedPlacement,
} from "@/lib/grouped-placement";
import {
  usePluginSlotKind,
  type PluginThreadContextCardRowSlot,
  type PluginThreadContextCardSectionSlot,
} from "@/lib/plugin-slots";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import { InfoSectionHeading } from "@/components/secondary-panel/info/info-list";
import { CORE_PLUGIN_ID } from "@bb/domain";
import { PluginSlotMount } from "./PluginSlotMount";
import { useOrderedReveal } from "@/lib/lazy-parts";
import {
  ThreadContextCardPaneContext,
  usePaneState,
} from "./thread-context-card-pane";
import {
  THREAD_CONTEXT_CARD_SECTION_HEADING_CLASS,
  ThreadContextCardSectionScopeContext,
  useThreadContextCardSectionCollapse,
} from "./ThreadContextCardSection";
import { threadContextSegmentKey } from "./PluginThreadContextSegments";

export interface CoreThreadContextCardRow {
  id: string;
  group: string;
  order: number;
  component: ComponentType<ExperimentalThreadContextCardProps>;
}

export interface CoreThreadContextCardSection {
  id: string;
  group: string;
  order: number;
  component: ComponentType<ExperimentalThreadContextCardProps>;
}

type ThreadContextCardRowEntry =
  | { owner: "core"; slot: CoreThreadContextCardRow }
  | { owner: "plugin"; slot: PluginThreadContextCardRowSlot };

type ThreadContextCardSectionEntry =
  | { owner: "core"; slot: CoreThreadContextCardSection }
  | { owner: "plugin"; slot: PluginThreadContextCardSectionSlot };

export type ThreadContextCardLayout = "card" | "banner";

const TRANSCRIPT_MAX_WIDTH_PX = 760;
const CARD_WIDTH_PX = 288;
const RESERVED_WIDTH_PX = CARD_WIDTH_PX + 24;
const TRANSCRIPT_CENTERED_MIN_WIDTH_PX =
  TRANSCRIPT_MAX_WIDTH_PX + 2 * RESERVED_WIDTH_PX;

export function resolveThreadContextCardLayout(
  paneWidth: number,
): ThreadContextCardLayout {
  return paneWidth - RESERVED_WIDTH_PX >= TRANSCRIPT_MAX_WIDTH_PX
    ? "card"
    : "banner";
}

const pinnedAtom = createSyncedPreferenceAtom("threadContextCard.pinned");

export interface ThreadContextCardPaneState {
  props: ExperimentalThreadContextCardProps;
  rows: readonly ThreadContextCardRowEntry[];
  sections: readonly ThreadContextCardSectionEntry[];
  layout: ThreadContextCardLayout;
  setLayout(layout: ThreadContextCardLayout): void;
  popoverOpen: boolean;
  setPopoverOpen(open: boolean): void;
  cardHasContent: boolean;
  setCardHasContent(hasContent: boolean): void;
  cardRevealed: boolean;
  setCardRevealedForThreadId(threadId: string | null): void;
}

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

const ORDERED_CARD_ENTRIES = {
  key: (entry: ThreadContextCardRowEntry | ThreadContextCardSectionEntry) =>
    entry.owner === "core"
      ? `core/${entry.slot.id}`
      : `${entry.slot.pluginId}/${entry.slot.id}/${entry.slot.generation}`,
  parts: (entry: ThreadContextCardRowEntry | ThreadContextCardSectionEntry) => [
    entry.slot.component,
  ],
};

export function ThreadContextCardProvider({
  enabled,
  coreRows,
  coreSections,
  threadId,
  projectId,
  environment,
  children,
}: ExperimentalThreadContextCardProps & {
  enabled: boolean;
  coreRows: readonly CoreThreadContextCardRow[];
  coreSections: readonly CoreThreadContextCardSection[];
  children: ReactNode;
}) {
  const threadContextCardRows = usePluginSlotKind("threadContextCardRows");
  const threadContextCardSections = usePluginSlotKind(
    "threadContextCardSections",
  );
  const [layout, setLayout] = useState<ThreadContextCardLayout>("banner");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [cardHasContent, setCardHasContent] = useState(false);
  const [cardRevealedForThreadId, setCardRevealedForThreadId] = useState<
    string | null
  >(null);
  const cardRevealed = cardRevealedForThreadId === threadId;
  const environmentId = environment?.id ?? null;
  const sortedRows = useMemo(
    () =>
      enabled
        ? sortByPlacement<ThreadContextCardRowEntry>(
            [
              ...coreRows.map((slot) => ({ owner: "core" as const, slot })),
              ...threadContextCardRows.map((slot) => ({
                owner: "plugin" as const,
                slot,
              })),
            ],
            (entry) => entry.slot,
          )
        : [],
    [coreRows, enabled, threadContextCardRows],
  );
  const sortedSections = useMemo(
    () =>
      enabled
        ? sortByPlacement<ThreadContextCardSectionEntry>(
            [
              ...coreSections.map((slot) => ({ owner: "core" as const, slot })),
              ...threadContextCardSections.map((slot) => ({
                owner: "plugin" as const,
                slot,
              })),
            ],
            (entry) => entry.slot,
          )
        : [],
    [coreSections, enabled, threadContextCardSections],
  );
  const rows = useOrderedReveal(sortedRows, ORDERED_CARD_ENTRIES);
  const sections = useOrderedReveal(sortedSections, ORDERED_CARD_ENTRIES);
  const value = useMemo<ThreadContextCardPaneState>(
    () => ({
      props: {
        threadId,
        projectId,
        environment: environmentId === null ? null : { id: environmentId },
      },
      rows,
      sections,
      layout,
      setLayout,
      popoverOpen,
      setPopoverOpen,
      cardHasContent,
      setCardHasContent,
      cardRevealed,
      setCardRevealedForThreadId,
    }),
    [
      cardHasContent,
      cardRevealed,
      environmentId,
      layout,
      popoverOpen,
      projectId,
      rows,
      sections,
      threadId,
    ],
  );
  return (
    <ThreadContextCardPaneContext.Provider value={value}>
      {children}
    </ThreadContextCardPaneContext.Provider>
  );
}

export function WithoutThreadContextCard({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ThreadContextCardPaneContext.Provider value={null}>
      {children}
    </ThreadContextCardPaneContext.Provider>
  );
}

function isCardShown(
  state: ThreadContextCardPaneState,
  pinned: boolean,
): boolean {
  return state.cardRevealed || (pinned && state.cardHasContent);
}

export function useThreadContextCardTranscriptCenteredMinWidth():
  | number
  | undefined {
  const state = usePaneState();
  const [pinned] = useAtom(pinnedAtom);
  return state !== null && state.layout === "card" && isCardShown(state, pinned)
    ? TRANSCRIPT_CENTERED_MIN_WIDTH_PX
    : undefined;
}

const CONTENT_SELECTOR =
  "[data-thread-context-card-body] :not([data-bb-plugin-root])";

const EMPTY_BLOCK_CLASS =
  "[&:not(:has([data-thread-context-card-body]_:not([data-bb-plugin-root])))]:hidden";

const SECTION_DIVIDER_CLASS =
  "[:is([data-thread-context-card-rows],[data-thread-context-card-section]):has([data-thread-context-card-body]_:not([data-bb-plugin-root]))~&]:mt-2 [:is([data-thread-context-card-rows],[data-thread-context-card-section]):has([data-thread-context-card-body]_:not([data-bb-plugin-root]))~&]:border-t [:is([data-thread-context-card-rows],[data-thread-context-card-section]):has([data-thread-context-card-body]_:not([data-bb-plugin-root]))~&]:border-border [:is([data-thread-context-card-rows],[data-thread-context-card-section]):has([data-thread-context-card-body]_:not([data-bb-plugin-root]))~&]:pt-2";

const SHOW_EMPTY_STATE_CLASS =
  "contents [&:not(:has([data-thread-context-card-body]_:not([data-bb-plugin-root])))>[data-thread-context-card-empty]]:flex";

const LEGACY_FRAME_SCOPE = { kind: "legacyFrame" } as const;

function ThreadContextCardSectionView({
  sectionKey,
  legacyTitle,
  children,
}: {
  sectionKey: string;
  legacyTitle: string | null;
  children: ReactNode;
}) {
  const collapse = useThreadContextCardSectionCollapse(sectionKey);
  const bodyId = useId();
  const scope = useMemo(
    () =>
      legacyTitle === null
        ? { kind: "foldable" as const, sectionKey }
        : LEGACY_FRAME_SCOPE,
    [legacyTitle, sectionKey],
  );
  const body = (
    <div data-thread-context-card-body="" className="contents">
      <ThreadContextCardSectionScopeContext.Provider value={scope}>
        {children}
      </ThreadContextCardSectionScopeContext.Provider>
    </div>
  );
  return (
    <section
      data-thread-context-card-section=""
      className={cn(SECTION_DIVIDER_CLASS, EMPTY_BLOCK_CLASS)}
    >
      {legacyTitle === null ? (
        body
      ) : (
        <>
          <InfoSectionHeading
            label={legacyTitle}
            collapse={collapse}
            bodyId={bodyId}
            className={THREAD_CONTEXT_CARD_SECTION_HEADING_CLASS}
          />
          <div id={bodyId} hidden={collapse.collapsed}>
            {body}
          </div>
        </>
      )}
    </section>
  );
}

function ThreadContextCardContent({
  state,
  onHasContentChange,
}: {
  state: ThreadContextCardPaneState;
  onHasContentChange?: (hasContent: boolean) => void;
}) {
  const { props } = state;
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !onHasContentChange) return;
    const measure = () =>
      onHasContentChange(root.querySelector(CONTENT_SELECTOR) !== null);
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      onHasContentChange(false);
    };
  }, [onHasContentChange]);

  return (
    <div ref={rootRef} className={SHOW_EMPTY_STATE_CLASS}>
      {state.rows.length > 0 ? (
        <div data-thread-context-card-rows="" className={EMPTY_BLOCK_CLASS}>
          <div data-thread-context-card-body="" className="contents">
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
                  slotKind="threadContextCardRow"
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
        const pluginId =
          entry.owner === "core" ? CORE_PLUGIN_ID : entry.slot.pluginId;
        return (
          <ThreadContextCardSectionView
            key={
              entry.owner === "core"
                ? `core/${entry.slot.id}`
                : `${pluginId}/${entry.slot.id}/${entry.slot.generation}/${props.threadId}`
            }
            sectionKey={threadContextSegmentKey({
              pluginId,
              id: entry.slot.id,
            })}
            legacyTitle={entry.owner === "core" ? null : entry.slot.legacyTitle}
          >
            {entry.owner === "core" ? (
              <Component {...props} />
            ) : (
              <PluginSlotMount
                pluginId={pluginId}
                slotKind="threadContextCardSection"
                slotId={entry.slot.id}
                instanceId={props.threadId}
                crashResetKey={String(entry.slot.generation)}
                crashFallback={null}
              >
                <Component {...props} />
              </PluginSlotMount>
            )}
          </ThreadContextCardSectionView>
        );
      })}
      <div
        data-thread-context-card-empty=""
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
  "overflow-y-auto overflow-x-hidden rounded-md border border-border bg-popover p-2 text-popover-foreground";

export function ThreadContextCard() {
  const state = usePaneState();
  const [pinned] = useAtom(pinnedAtom);
  const probeRef = useRef<HTMLSpanElement>(null);
  const setLayout = state?.setLayout;

  useLayoutEffect(() => {
    const overlay = probeRef.current?.closest<HTMLElement>(
      "[data-scroll-overlay]",
    );
    if (!overlay || !setLayout) return;
    const measure = () => resolveThreadContextCardLayout(overlay.clientWidth);
    setLayout(measure());
    return observeSharedResize(overlay, { read: measure, write: setLayout });
  }, [setLayout]);

  if (state === null) return null;
  return (
    <>
      <span ref={probeRef} aria-hidden className="hidden" />
      {state.layout !== "banner" ? (
        <div
          role="group"
          aria-label="Thread context"
          data-thread-context-card=""
          hidden={!isCardShown(state, pinned)}
          className={cn(
            "pointer-events-auto max-h-[min(36rem,calc(100%-1.5rem))] w-72 shrink-0",
            CARD_CLASS,
          )}
        >
          <ThreadContextCardContent
            state={state}
            onHasContentChange={state.setCardHasContent}
          />
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

export function ThreadContextCardHeaderButton() {
  const state = usePaneState();
  const [pinned, setPinned] = useAtom(pinnedAtom);
  if (state === null) return null;
  if (state.layout !== "banner") {
    const shown = isCardShown(state, pinned);
    const label = shown ? "Unpin thread context" : "Pin thread context";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={shown}
            className={HEADER_BUTTON_CLASS}
            onClick={() => {
              if (state.cardHasContent) setPinned(!shown);
              state.setCardRevealedForThreadId(
                shown ? null : state.props.threadId,
              );
            }}
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
              aria-label="Thread context"
              className={HEADER_BUTTON_CLASS}
            >
              <Icon name="LayoutList" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Thread context</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        mobileTitle="Thread context"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="max-h-[min(36rem,calc(100dvh-6rem))] w-72 overflow-y-auto p-0 shadow-none"
      >
        <div
          role="group"
          aria-label="Thread context"
          data-thread-context-card=""
          className="overflow-hidden p-2"
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("button[data-thread-context-card-row]")
            ) {
              state.setPopoverOpen(false);
            }
          }}
        >
          <ThreadContextCardContent state={state} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

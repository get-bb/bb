import {
  useEffect,
  useLayoutEffect,
  useState,
  type ComponentType,
  type ReactNode,
  type RefCallback,
} from "react";
import { useOrderedReveal } from "@/lib/lazy-parts";
import type {
  ExperimentalThreadContextSegmentInput,
  ExperimentalThreadContextSegmentProps,
} from "@get-bb/plugin-sdk";
import type { CollectedThreadContextItemBanner } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import {
  usePluginSlotKind,
  type PluginThreadContextItemSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";
import { useThreadContextKind } from "./thread-context-card-pane";

export type ThreadContextSegmentPart = "summary" | "action" | "details";

export type ThreadContextBannerSlot = PluginThreadContextItemSlot & {
  banner: CollectedThreadContextItemBanner;
};

export function threadContextSegmentKey(segment: {
  pluginId: string;
  id: string;
}): string {
  return `${segment.pluginId}/${segment.id}`;
}

function hasBanner(
  slot: PluginThreadContextItemSlot,
): slot is ThreadContextBannerSlot {
  return slot.banner !== null;
}

export function sortThreadContextItems<
  Slot extends PluginThreadContextItemSlot,
>(slots: readonly Slot[]): Slot[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((left, right) =>
      compareGroupedPlacement(left.slot, left.index, right.slot, right.index),
    )
    .map(({ slot }) => slot);
}

type VisibilityReport = (
  banner: CollectedThreadContextItemBanner,
  threadId: string,
  visible: boolean | null,
) => void;

type VisibilityHostProps = {
  input: ExperimentalThreadContextSegmentInput;
  onVisible: VisibilityReport;
};

const visibilityHosts = new WeakMap<
  CollectedThreadContextItemBanner,
  { Visibility: ComponentType<VisibilityHostProps> }
>();

function useReportVisibility(
  banner: CollectedThreadContextItemBanner,
  threadId: string,
  visible: unknown,
  onVisible: VisibilityReport,
) {
  if (typeof visible !== "boolean") {
    throw new Error("useVisible must return a boolean");
  }
  useLayoutEffect(() => {
    onVisible(banner, threadId, visible);
    return () => onVisible(banner, threadId, null);
  }, [banner, threadId, visible, onVisible]);
}

function visibilityHostFor(
  banner: CollectedThreadContextItemBanner & {
    useVisible: NonNullable<CollectedThreadContextItemBanner["useVisible"]>;
  },
) {
  const existing = visibilityHosts.get(banner);
  if (existing !== undefined) return existing;
  function SegmentVisibility({ input, onVisible }: VisibilityHostProps) {
    const visible = banner.useVisible(input);
    useReportVisibility(banner, input.threadId, visible, onVisible);
    return null;
  }
  const host = { Visibility: SegmentVisibility };
  visibilityHosts.set(banner, host);
  return host;
}

function hasUseVisible(
  banner: CollectedThreadContextItemBanner,
): banner is Parameters<typeof visibilityHostFor>[0] {
  return banner.useVisible !== undefined;
}

function AlwaysVisible({
  banner,
  input,
  onVisible,
}: {
  banner: CollectedThreadContextItemBanner;
} & VisibilityHostProps) {
  useReportVisibility(banner, input.threadId, true, onVisible);
  return null;
}

function Visibility({
  banner,
  input,
  onVisible,
}: {
  banner: CollectedThreadContextItemBanner;
} & VisibilityHostProps) {
  if (!hasUseVisible(banner)) {
    return (
      <AlwaysVisible banner={banner} input={input} onVisible={onVisible} />
    );
  }
  const host = visibilityHostFor(banner);
  return <host.Visibility input={input} onVisible={onVisible} />;
}

function slotKey(slot: ThreadContextBannerSlot, threadId: string): string {
  return `${threadContextSegmentKey(slot)}/${slot.generation}/${threadId}`;
}

function VisibilityObserver({
  slot,
  input,
  onVisible,
}: {
  slot: ThreadContextBannerSlot;
  input: ExperimentalThreadContextSegmentInput;
  onVisible: VisibilityReport;
}) {
  return (
    <PluginSlotMount
      pluginId={slot.pluginId}
      slotKind="threadContextSegment/visibility"
      slotId={slot.id}
      instanceId={input.threadId}
      crashResetKey={String(slot.generation)}
      crashFallback={null}
      wrapRoot={false}
      onCrash={() => onVisible(slot.banner, input.threadId, false)}
    >
      <Visibility banner={slot.banner} input={input} onVisible={onVisible} />
    </PluginSlotMount>
  );
}

export function useThreadContextSegments(
  input: ExperimentalThreadContextSegmentInput,
  core: readonly PluginThreadContextItemSlot[],
): {
  slots: readonly ThreadContextBannerSlot[];
  observers: ReactNode;
} {
  const pluginSlots = usePluginSlotKind("threadContextItems");
  return useVisibleThreadContextSegments(
    input,
    sortThreadContextItems([...core, ...pluginSlots]),
  );
}

export function useVisibleThreadContextSegments(
  input: ExperimentalThreadContextSegmentInput,
  candidates: readonly PluginThreadContextItemSlot[],
): {
  slots: readonly ThreadContextBannerSlot[];
  observers: ReactNode;
} {
  const kind = useThreadContextKind();
  const { threadId } = input;
  const placed = useOrderedReveal(
    candidates
      .filter(hasBanner)
      .filter((slot) => kind === "banner" || slot.card === null),
    {
      key: (slot) => slotKey(slot, threadId),
      parts: (slot) => [
        slot.banner.summary,
        slot.banner.action,
        slot.banner.details,
      ],
    },
  );
  const [visibility, setVisibility] = useState<
    ReadonlyMap<
      CollectedThreadContextItemBanner,
      { threadId: string; visible: boolean }
    >
  >(() => new Map());
  const [onVisible] = useState<VisibilityReport>(
    () =>
      (
        banner: CollectedThreadContextItemBanner,
        threadId: string,
        visible: boolean | null,
      ) => {
        setVisibility((current) => {
          const previous = current.get(banner);
          const unchanged =
            visible === null
              ? previous === undefined || previous.threadId !== threadId
              : previous !== undefined &&
                previous.threadId === threadId &&
                previous.visible === visible;
          if (unchanged) return current;
          const next = new Map(current);
          if (visible === null) next.delete(banner);
          else next.set(banner, { threadId, visible });
          return next;
        });
      },
  );
  return {
    slots: placed.filter((slot) => {
      if (slot.banner.useVisible === undefined) return true;
      const reported = visibility.get(slot.banner);
      return reported?.threadId === threadId && reported.visible;
    }),
    observers: placed
      .filter((slot) => slot.banner.useVisible !== undefined)
      .map((slot) => (
        <VisibilityObserver
          key={slotKey(slot, threadId)}
          slot={slot}
          input={input}
          onVisible={onVisible}
        />
      )),
  };
}

type SegmentFocusTarget = "toggle" | "collapse";

interface SegmentFocusHandles {
  elements: Record<SegmentFocusTarget, HTMLElement | null>;
  toggleRef: RefCallback<HTMLElement>;
  collapseRef: RefCallback<HTMLElement>;
}

function createSegmentFocusRegistry() {
  const handles = new Map<string, SegmentFocusHandles>();
  let pending: { key: string; target: SegmentFocusTarget } | null = null;
  const refFor =
    (
      elements: SegmentFocusHandles["elements"],
      target: SegmentFocusTarget,
    ): RefCallback<HTMLElement> =>
    (element) => {
      elements[target] = element;
      return () => {
        if (elements[target] === element) elements[target] = null;
      };
    };
  const handlesFor = (key: string): SegmentFocusHandles => {
    const existing = handles.get(key);
    if (existing !== undefined) return existing;
    const elements: SegmentFocusHandles["elements"] = {
      toggle: null,
      collapse: null,
    };
    const created = {
      elements,
      toggleRef: refFor(elements, "toggle"),
      collapseRef: refFor(elements, "collapse"),
    };
    handles.set(key, created);
    return created;
  };
  return {
    handlesFor,
    toggle(key: string, isExpanded: boolean, toggle: () => void) {
      const { elements } = handlesFor(key);
      const focused = document.activeElement;
      const hasFocus =
        focused !== null &&
        (elements.toggle?.contains(focused) === true ||
          elements.collapse?.contains(focused) === true);
      pending = hasFocus
        ? { key, target: isExpanded ? "toggle" : "collapse" }
        : null;
      toggle();
    },
    flush() {
      const next = pending;
      pending = null;
      if (next !== null) handles.get(next.key)?.elements[next.target]?.focus();
    },
  };
}

export type ThreadContextSegmentDisclosure = Pick<
  ExperimentalThreadContextSegmentProps,
  "isExpanded" | "onToggle" | "toggleRef" | "collapseRef"
>;

export function useThreadContextSegmentDisclosure(
  expandedSegment: string | null,
  onToggleSegment: (key: string) => void,
): (key: string) => ThreadContextSegmentDisclosure {
  const [registry] = useState(createSegmentFocusRegistry);
  useEffect(() => {
    registry.flush();
  }, [expandedSegment, registry]);
  return (key) => {
    const { toggleRef, collapseRef } = registry.handlesFor(key);
    const isExpanded = expandedSegment === key;
    return {
      isExpanded,
      onToggle: () =>
        registry.toggle(key, isExpanded, () => onToggleSegment(key)),
      toggleRef,
      collapseRef,
    };
  };
}

export function ThreadContextSegmentMount({
  slot,
  part,
  ...props
}: ExperimentalThreadContextSegmentProps & {
  slot: ThreadContextBannerSlot;
  part: ThreadContextSegmentPart;
}) {
  const Content = slot.banner[part];
  if (Content === undefined) return null;
  return (
    <PluginSlotMount
      pluginId={slot.pluginId}
      slotKind={`threadContextSegment/${part}`}
      slotId={slot.id}
      instanceId={props.threadId}
      crashResetKey={String(slot.generation)}
      crashFallback={null}
    >
      {part === "summary" ? (
        <span role="group" aria-label={slot.banner.title} className="contents">
          <Content {...props} />
        </span>
      ) : (
        <Content {...props} />
      )}
    </PluginSlotMount>
  );
}

export function threadContextSegmentMountKey(
  slot: ThreadContextBannerSlot,
  threadId: string,
  part: ThreadContextSegmentPart,
): string {
  return `${slotKey(slot, threadId)}/${part}`;
}

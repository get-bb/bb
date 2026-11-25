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
  ExperimentalThreadContextSegmentRegistration,
} from "@get-bb/plugin-sdk";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import {
  usePluginSlotKind,
  type PluginThreadContextSegmentSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";
import type { CoreContributionSlot } from "@/lib/core-contributions";

export type CoreThreadContextSegment =
  CoreContributionSlot<"threadContextSegments">;

export type ThreadContextSegmentEntry =
  | { owner: "core"; slot: CoreThreadContextSegment }
  | { owner: "plugin"; slot: PluginThreadContextSegmentSlot };

export type ThreadContextSegmentPart = "summary" | "action" | "details";

export function threadContextSegmentKey(segment: {
  pluginId: string;
  id: string;
}): string {
  return `${segment.pluginId}/${segment.id}`;
}

function sortThreadContextSegments(
  entries: readonly ThreadContextSegmentEntry[],
): ThreadContextSegmentEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) =>
      compareGroupedPlacement(
        left.entry.slot,
        left.index,
        right.entry.slot,
        right.index,
      ),
    )
    .map(({ entry }) => entry);
}

type VisibilityReport = (
  slot: ExperimentalThreadContextSegmentRegistration,
  threadId: string,
  visible: boolean | null,
) => void;

type VisibilityHostProps = {
  input: ExperimentalThreadContextSegmentInput;
  onVisible: VisibilityReport;
};

const visibilityHosts = new WeakMap<
  ExperimentalThreadContextSegmentRegistration,
  { Visibility: ComponentType<VisibilityHostProps> }
>();

function useReportVisibility(
  slot: ExperimentalThreadContextSegmentRegistration,
  threadId: string,
  visible: unknown,
  onVisible: VisibilityReport,
) {
  if (typeof visible !== "boolean") {
    throw new Error("useVisible must return a boolean");
  }
  useLayoutEffect(() => {
    onVisible(slot, threadId, visible);
    return () => onVisible(slot, threadId, null);
  }, [slot, threadId, visible, onVisible]);
}

function visibilityHostFor(
  slot: ExperimentalThreadContextSegmentRegistration & {
    useVisible: NonNullable<
      ExperimentalThreadContextSegmentRegistration["useVisible"]
    >;
  },
) {
  const existing = visibilityHosts.get(slot);
  if (existing !== undefined) return existing;
  function SegmentVisibility({ input, onVisible }: VisibilityHostProps) {
    const visible = slot.useVisible(input);
    useReportVisibility(slot, input.threadId, visible, onVisible);
    return null;
  }
  const host = { Visibility: SegmentVisibility };
  visibilityHosts.set(slot, host);
  return host;
}

function hasUseVisible(
  slot: ExperimentalThreadContextSegmentRegistration,
): slot is Parameters<typeof visibilityHostFor>[0] {
  return slot.useVisible !== undefined;
}

function AlwaysVisible({
  slot,
  input,
  onVisible,
}: {
  slot: ExperimentalThreadContextSegmentRegistration;
} & VisibilityHostProps) {
  useReportVisibility(slot, input.threadId, true, onVisible);
  return null;
}

function Visibility({
  slot,
  input,
  onVisible,
}: {
  slot: ExperimentalThreadContextSegmentRegistration;
} & VisibilityHostProps) {
  if (!hasUseVisible(slot)) {
    return <AlwaysVisible slot={slot} input={input} onVisible={onVisible} />;
  }
  const host = visibilityHostFor(slot);
  return <host.Visibility input={input} onVisible={onVisible} />;
}

function entryKey(entry: ThreadContextSegmentEntry, threadId: string): string {
  const generation = entry.owner === "plugin" ? entry.slot.generation : 0;
  return `${threadContextSegmentKey(entry.slot)}/${generation}/${threadId}`;
}

function VisibilityObserver({
  entry,
  input,
  onVisible,
}: {
  entry: ThreadContextSegmentEntry;
  input: ExperimentalThreadContextSegmentInput;
  onVisible: VisibilityReport;
}) {
  if (entry.owner === "core") {
    return <Visibility slot={entry.slot} input={input} onVisible={onVisible} />;
  }
  const { slot } = entry;
  return (
    <PluginSlotMount
      pluginId={slot.pluginId}
      slotKind="threadContextSegment/visibility"
      slotId={slot.id}
      instanceId={input.threadId}
      crashResetKey={String(slot.generation)}
      crashFallback={null}
      wrapRoot={false}
      onCrash={() => onVisible(slot, input.threadId, false)}
    >
      <Visibility slot={slot} input={input} onVisible={onVisible} />
    </PluginSlotMount>
  );
}

export function useThreadContextSegments(
  input: ExperimentalThreadContextSegmentInput,
  core: readonly CoreThreadContextSegment[],
): {
  entries: readonly ThreadContextSegmentEntry[];
  observers: ReactNode;
} {
  const threadContextSegments = usePluginSlotKind("threadContextSegments");
  const { threadId } = input;
  const entries = useOrderedReveal(
    sortThreadContextSegments([
      ...core.map((slot) => ({ owner: "core" as const, slot })),
      ...threadContextSegments.map((slot) => ({
        owner: "plugin" as const,
        slot,
      })),
    ]),
    {
      key: (entry) => entryKey(entry, threadId),
      parts: (entry) => [
        entry.slot.summary,
        entry.slot.action,
        entry.slot.details,
      ],
    },
  );
  const [visibility, setVisibility] = useState<
    ReadonlyMap<
      ExperimentalThreadContextSegmentRegistration,
      { threadId: string; visible: boolean }
    >
  >(() => new Map());
  const [onVisible] = useState<VisibilityReport>(
    () =>
      (
        slot: ExperimentalThreadContextSegmentRegistration,
        threadId: string,
        visible: boolean | null,
      ) => {
        setVisibility((current) => {
          const previous = current.get(slot);
          const unchanged =
            visible === null
              ? previous === undefined || previous.threadId !== threadId
              : previous !== undefined &&
                previous.threadId === threadId &&
                previous.visible === visible;
          if (unchanged) return current;
          const next = new Map(current);
          if (visible === null) next.delete(slot);
          else next.set(slot, { threadId, visible });
          return next;
        });
      },
  );
  return {
    entries: entries.filter(({ slot }) => {
      if (slot.useVisible === undefined) return true;
      const reported = visibility.get(slot);
      return reported?.threadId === threadId && reported.visible;
    }),
    observers: entries
      .filter(({ slot }) => slot.useVisible !== undefined)
      .map((entry) => (
        <VisibilityObserver
          key={entryKey(entry, threadId)}
          entry={entry}
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
  entry,
  part,
  ...props
}: ExperimentalThreadContextSegmentProps & {
  entry: ThreadContextSegmentEntry;
  part: ThreadContextSegmentPart;
}) {
  const Content = entry.slot[part];
  if (Content === undefined) return null;
  if (entry.owner === "core") return <Content {...props} />;
  const { slot } = entry;
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
        <span role="group" aria-label={slot.title} className="contents">
          <Content {...props} />
        </span>
      ) : (
        <Content {...props} />
      )}
    </PluginSlotMount>
  );
}

export function threadContextSegmentMountKey(
  entry: ThreadContextSegmentEntry,
  threadId: string,
  part: ThreadContextSegmentPart,
): string {
  return `${entryKey(entry, threadId)}/${part}`;
}

import { useLayoutEffect, useState, type ReactNode } from "react";
import type {
  ExperimentalThreadContextSegmentInput,
  ExperimentalThreadContextSegmentProps,
  ExperimentalThreadContextSegmentReference,
  ExperimentalThreadContextSegmentRegistration,
} from "@get-bb/plugin-sdk";
import {
  usePluginSlots,
  type PluginThreadContextSegmentSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

export const CORE_THREAD_CONTEXT_OWNER = "core";

export type CoreThreadContextSegment =
  ExperimentalThreadContextSegmentRegistration & { pluginId: "core" };

export type ThreadContextSegmentEntry =
  | { owner: "core"; slot: CoreThreadContextSegment }
  | { owner: "plugin"; slot: PluginThreadContextSegmentSlot };

export function threadContextSegmentKey(
  segment: ExperimentalThreadContextSegmentReference,
): string {
  return `${segment.pluginId}/${segment.id}`;
}

function sortThreadContextSegments(
  entries: readonly ThreadContextSegmentEntry[],
): ThreadContextSegmentEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        (left.entry.slot.order ?? Number.POSITIVE_INFINITY) -
          (right.entry.slot.order ?? Number.POSITIVE_INFINITY) ||
        left.index - right.index,
    )
    .map(({ entry }) => entry);
}

type VisibilityReport = (
  slot: ExperimentalThreadContextSegmentRegistration,
  threadId: string,
  visible: boolean | null,
) => void;

function Visibility({
  slot,
  input,
  onVisible,
}: {
  slot: ExperimentalThreadContextSegmentRegistration;
  input: ExperimentalThreadContextSegmentInput;
  onVisible: VisibilityReport;
}) {
  const visible = slot.useVisible ? slot.useVisible(input) : true;
  if (typeof visible !== "boolean") {
    throw new Error("useVisible must return a boolean");
  }
  const { threadId } = input;
  useLayoutEffect(() => {
    onVisible(slot, threadId, visible);
    return () => onVisible(slot, threadId, null);
  }, [slot, threadId, visible, onVisible]);
  return null;
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
  const { threadContextSegments } = usePluginSlots();
  const entries = sortThreadContextSegments([
    ...core.map((slot) => ({ owner: "core" as const, slot })),
    ...threadContextSegments.map((slot) => ({
      owner: "plugin" as const,
      slot,
    })),
  ]);
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
  const { threadId } = input;
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

export function ThreadContextSegmentMount({
  entry,
  ...props
}: ExperimentalThreadContextSegmentProps & {
  entry: ThreadContextSegmentEntry;
}) {
  const Content = entry.slot.component;
  if (entry.owner === "core") return <Content {...props} />;
  const { slot } = entry;
  return (
    <PluginSlotMount
      pluginId={slot.pluginId}
      slotKind={`threadContextSegment/${props.part}`}
      slotId={slot.id}
      instanceId={props.threadId}
      crashResetKey={String(slot.generation)}
      crashFallback={null}
    >
      {props.part === "summary" && slot.placement !== "before" ? (
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
  part: ExperimentalThreadContextSegmentProps["part"],
): string {
  return `${entryKey(entry, threadId)}/${part}`;
}

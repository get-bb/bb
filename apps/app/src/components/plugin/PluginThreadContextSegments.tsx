import { useLayoutEffect, useState, type ReactNode } from "react";
import type {
  ExperimentalThreadContextSegmentInput,
  ExperimentalThreadContextSegmentProps,
  ExperimentalThreadContextSegmentRegistration,
} from "@get-bb/plugin-sdk";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import {
  usePluginSlots,
  type PluginThreadContextSegmentSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

export const CORE_THREAD_CONTEXT_OWNER = "bb--core";

export type CoreThreadContextSegment =
  ExperimentalThreadContextSegmentRegistration & {
    pluginId: typeof CORE_THREAD_CONTEXT_OWNER;
  };

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

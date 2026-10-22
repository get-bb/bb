import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import {
  isNavTab,
  isThreadTab,
  usePluginSlots,
  type PluginTabSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

export type PluginTabContext =
  | { kind: "thread"; threadId: string }
  | { kind: "nav-panel"; pluginId: string; panelId: string; subPath: string };

export function PluginTabScope({
  slot,
  instanceId,
  children,
  crashFallback,
}: {
  slot: PluginTabSlot;
  instanceId: string;
  children: ReactNode;
  crashFallback?: ReactNode;
}) {
  return (
    <PluginSlotMount
      key={`${slot.pluginId}/${slot.context.kind}/${slot.context.kind === "nav-panel" ? slot.context.panelId : ""}/${slot.id}/${slot.generation}/${instanceId}`}
      pluginId={slot.pluginId}
      slotKind="tab"
      slotId={slot.id}
      instanceId={instanceId}
      crashResetKey={String(slot.generation)}
      {...(crashFallback === undefined ? {} : { crashFallback })}
    >
      {children}
    </PluginSlotMount>
  );
}

type VisibilityResultProps = {
  slot: PluginTabSlot;
  contextKey: string;
  visible: boolean | null;
  report(
    slot: PluginTabSlot,
    contextKey: string,
    visible: boolean | null,
  ): void;
};

function VisibilityResult({
  slot,
  contextKey,
  visible,
  report,
}: VisibilityResultProps) {
  useLayoutEffect(() => {
    report(slot, contextKey, visible);
    return () => report(slot, contextKey, null);
  }, [slot, contextKey, visible, report]);
  return null;
}

function Visibility({
  context,
  ...props
}: Omit<VisibilityResultProps, "visible"> & { context: PluginTabContext }) {
  const { slot } = props;
  const visible =
    isThreadTab(slot) && context.kind === "thread"
      ? (slot.useVisible?.({ threadId: context.threadId }) ?? true)
      : isNavTab(slot) && context.kind === "nav-panel"
        ? (slot.useVisible?.({ subPath: context.subPath }) ?? true)
        : false;
  return <VisibilityResult {...props} visible={visible} />;
}

export function usePluginTabs(context: PluginTabContext | null) {
  const { tabs } = usePluginSlots();
  const contextKey =
    context === null
      ? ""
      : context.kind === "thread"
        ? `thread/${context.threadId}`
        : `nav-panel/${context.pluginId}/${context.panelId}/${context.subPath}`;
  const kind = context?.kind;
  const panelId = context?.kind === "nav-panel" ? context.panelId : null;
  const pluginId = context?.kind === "nav-panel" ? context.pluginId : null;
  const applicable = useMemo(
    () =>
      contextKey === ""
        ? []
        : tabs.filter((slot) =>
            slot.context.kind === "thread"
              ? kind === "thread"
              : kind === "nav-panel" &&
                slot.pluginId === pluginId &&
                slot.context.panelId === panelId,
          ),
    [tabs, kind, panelId, pluginId, contextKey],
  );
  const [visibility, setVisibility] = useState<
    ReadonlyMap<PluginTabSlot, { contextKey: string; visible: boolean }>
  >(() => new Map());
  const report = useCallback(
    (slot: PluginTabSlot, key: string, visible: boolean | null) => {
      setVisibility((current) => {
        const previous = current.get(slot);
        if (
          visible === null
            ? previous?.contextKey !== key
            : previous?.contextKey === key && previous.visible === visible
        )
          return current;
        const next = new Map(current);
        if (visible === null) next.delete(slot);
        else next.set(slot, { contextKey: key, visible });
        return next;
      });
    },
    [],
  );
  const slots = useMemo(
    () =>
      applicable.filter(
        (slot) =>
          slot.useVisible === undefined ||
          (visibility.get(slot)?.contextKey === contextKey &&
            visibility.get(slot)?.visible === true),
      ),
    [applicable, contextKey, visibility],
  );
  const observers =
    context === null
      ? []
      : applicable
          .filter((slot) => slot.useVisible !== undefined)
          .map((slot) => (
            <PluginTabScope
              key={`${slot.pluginId}/${slot.id}/${slot.generation}/${contextKey}`}
              slot={slot}
              instanceId={`${contextKey}/visibility`}
              crashFallback={
                <VisibilityResult
                  slot={slot}
                  contextKey={contextKey}
                  visible={false}
                  report={report}
                />
              }
            >
              <Visibility
                slot={slot}
                context={context}
                contextKey={contextKey}
                report={report}
              />
            </PluginTabScope>
          ));
  const settled = usePluginFrontendsSettled();
  const isReady =
    context !== null &&
    settled &&
    applicable.every(
      (slot) =>
        slot.useVisible === undefined ||
        visibility.get(slot)?.contextKey === contextKey,
    );
  return { slots, observers, isReady };
}

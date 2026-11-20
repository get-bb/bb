import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  isNavTab,
  isThreadTab,
  useIsPluginFrontendSettled,
  usePluginSlotKind,
  type PluginNavTabSlot,
  type PluginTabSlot,
  type PluginThreadTabSlot,
} from "@/lib/plugin-slots";
import type { ExperimentalThreadEnvironment } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "./PluginSlotMount";

export type PluginTabContext =
  | {
      kind: "thread";
      threadId: string;
      environment: ExperimentalThreadEnvironment | null;
    }
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

type HostProps = Omit<VisibilityResultProps, "visible" | "slot">;
type ThreadTabHostProps = HostProps & {
  threadId: string;
  environment: ExperimentalThreadEnvironment | null;
};
type NavTabHostProps = HostProps & { subPath: string };

const threadTabVisibilityHosts = new WeakMap<
  PluginThreadTabSlot,
  { Visibility: ComponentType<ThreadTabHostProps> }
>();
const navTabVisibilityHosts = new WeakMap<
  PluginNavTabSlot,
  { Visibility: ComponentType<NavTabHostProps> }
>();

function threadTabVisibilityHost(
  slot: PluginThreadTabSlot & {
    useVisible: NonNullable<PluginThreadTabSlot["useVisible"]>;
  },
) {
  const existing = threadTabVisibilityHosts.get(slot);
  if (existing !== undefined) return existing;
  function ThreadTabVisibility({
    threadId,
    environment,
    ...props
  }: ThreadTabHostProps) {
    const visible = slot.useVisible({ threadId, environment }) ?? true;
    return <VisibilityResult {...props} slot={slot} visible={visible} />;
  }
  const host = { Visibility: ThreadTabVisibility };
  threadTabVisibilityHosts.set(slot, host);
  return host;
}

function navTabVisibilityHost(
  slot: PluginNavTabSlot & {
    useVisible: NonNullable<PluginNavTabSlot["useVisible"]>;
  },
) {
  const existing = navTabVisibilityHosts.get(slot);
  if (existing !== undefined) return existing;
  function NavTabVisibility({ subPath, ...props }: NavTabHostProps) {
    const visible = slot.useVisible({ subPath }) ?? true;
    return <VisibilityResult {...props} slot={slot} visible={visible} />;
  }
  const host = { Visibility: NavTabVisibility };
  navTabVisibilityHosts.set(slot, host);
  return host;
}

function hasUseVisible<Slot extends PluginTabSlot>(
  slot: Slot,
): slot is Slot & { useVisible: NonNullable<Slot["useVisible"]> } {
  return slot.useVisible !== undefined;
}

function Visibility({
  context,
  ...props
}: Omit<VisibilityResultProps, "visible"> & { context: PluginTabContext }) {
  const { slot, ...hostProps } = props;
  if (isThreadTab(slot) && context.kind === "thread") {
    if (!hasUseVisible(slot)) return <VisibilityResult {...props} visible />;
    const host = threadTabVisibilityHost(slot);
    return (
      <host.Visibility
        {...hostProps}
        threadId={context.threadId}
        environment={context.environment}
      />
    );
  }
  if (isNavTab(slot) && context.kind === "nav-panel") {
    if (!hasUseVisible(slot)) return <VisibilityResult {...props} visible />;
    const host = navTabVisibilityHost(slot);
    return <host.Visibility {...hostProps} subPath={context.subPath} />;
  }
  return <VisibilityResult {...props} visible={false} />;
}

export function usePluginTabs(
  context: PluginTabContext | null,
  awaitedPluginIds: readonly string[] | null,
) {
  const tabs = usePluginSlotKind("tabs");
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
  const isPluginSettled = useIsPluginFrontendSettled();
  const isReady =
    context !== null &&
    awaitedPluginIds !== null &&
    awaitedPluginIds.every(isPluginSettled) &&
    applicable.every(
      (slot) =>
        slot.useVisible === undefined ||
        visibility.get(slot)?.contextKey === contextKey,
    );
  return { slots, observers, isReady };
}

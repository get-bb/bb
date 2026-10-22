import type {
  ExperimentalSidebarFooterActionContext,
  ExperimentalSidebarFooterDisclosureController,
  ExperimentalSidebarFooterItemRegistration,
  PluginSidebarFooterActionRegistration,
} from "@get-bb/plugin-sdk";

export type ExperimentalSidebarFooterCommandKind = "open" | "close" | "toggle";

export interface ExperimentalSidebarFooterRuntimeSnapshot {
  command: {
    sequence: number;
    kind: ExperimentalSidebarFooterCommandKind;
  } | null;
}

export interface ExperimentalSidebarFooterItemRuntime {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ExperimentalSidebarFooterRuntimeSnapshot;
  acknowledgeCommand(sequence: number): void;
}

export type CollectedExperimentalSidebarFooterItem =
  ExperimentalSidebarFooterItemRegistration & {
    runtime: ExperimentalSidebarFooterItemRuntime;
  };

export type CollectedManagedSidebarFooterItem =
  CollectedExperimentalSidebarFooterItem & {
    source: "experimental_sidebarFooter";
  };

export interface CollectedCompatibilitySidebarFooterItem {
  source: "sidebarFooterAction";
  id: string;
  label: string;
  icon: string;
  kind: "action";
  onActivate(
    context: ExperimentalSidebarFooterActionContext,
  ): void | Promise<void>;
  runtime: ExperimentalSidebarFooterItemRuntime;
}

export type CollectedSidebarFooterItem =
  | CollectedCompatibilitySidebarFooterItem
  | CollectedManagedSidebarFooterItem;

let sidebarFooterCommandSequence = 0;

export class SidebarFooterItemRuntime implements ExperimentalSidebarFooterItemRuntime {
  private readonly listeners = new Set<() => void>();
  private snapshot: ExperimentalSidebarFooterRuntimeSnapshot = {
    command: null,
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ExperimentalSidebarFooterRuntimeSnapshot =>
    this.snapshot;

  readonly acknowledgeCommand = (sequence: number): void => {
    if (this.snapshot.command?.sequence !== sequence) return;
    this.snapshot = { ...this.snapshot, command: null };
    this.emit();
  };

  createDisclosureController(): ExperimentalSidebarFooterDisclosureController {
    return Object.freeze({
      open: () => this.request("open"),
      close: () => this.request("close"),
      toggle: () => this.request("toggle"),
    });
  }

  private request(kind: ExperimentalSidebarFooterCommandKind): void {
    sidebarFooterCommandSequence += 1;
    this.snapshot = {
      ...this.snapshot,
      command: { sequence: sidebarFooterCommandSequence, kind },
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function adaptSidebarFooterAction(
  registration: PluginSidebarFooterActionRegistration,
): CollectedCompatibilitySidebarFooterItem {
  return {
    source: "sidebarFooterAction",
    id: registration.id,
    label: registration.title,
    icon: registration.icon,
    kind: "action",
    onActivate: ({ openPluginDetails }) =>
      registration.run({ openSettings: openPluginDetails }),
    runtime: new SidebarFooterItemRuntime(),
  };
}

export const sidebarFooterItemsByRegistrationSet = new WeakMap<
  object,
  readonly CollectedSidebarFooterItem[]
>();

export function getCollectedSidebarFooterItems(
  registrations: object,
): readonly CollectedSidebarFooterItem[] | null {
  return sidebarFooterItemsByRegistrationSet.get(registrations) ?? null;
}

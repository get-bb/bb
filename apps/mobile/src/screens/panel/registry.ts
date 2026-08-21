import type { FixedPanelTab } from "@bb/client-core";
import type { ComponentType } from "react";
import type {
  FilesLauncherParams,
  PanelLauncherId,
  PanelScope,
} from "./panel-model";

/**
 * Content registry of the workspace panel. The panel shell owns the sheet,
 * the tab strip and the tab state; what a tab *shows* is registered per tab
 * kind (and per launcher) by the feature that owns it — Diff, Files /
 * previews, Terminal — so those can land independently. Unregistered kinds
 * render a placeholder. See README.md in this folder for the contract.
 */

type PanelTabKind = FixedPanelTab["kind"];

export type PanelTabOfKind<K extends PanelTabKind> = Extract<
  FixedPanelTab,
  { kind: K }
>;

export interface PanelTabContentProps<T extends FixedPanelTab = FixedPanelTab> {
  scope: PanelScope;
  tab: T;
  /** This tab is the one on screen (retained contents render inactive ones hidden). */
  active: boolean;
  /** The sheet is presented (pause expensive work while it is not). */
  panelVisible: boolean;
}

export interface PanelLauncherContentProps {
  scope: PanelScope;
  launcher: PanelLauncherId;
  active: boolean;
  panelVisible: boolean;
  /**
   * Files launcher only: what it was opened with (section / query); null
   * when the user simply tapped the strip entry. Read once, then call
   * `usePanel().consumeFilesParams()`.
   */
  filesParams: FilesLauncherParams | null;
}

interface PanelContentOptions {
  /**
   * Keep the content mounted (hidden) while another tab is active, so
   * sockets / scroll positions / WebViews survive tab switches. Default off:
   * inactive contents unmount.
   */
  retainWhenInactive?: boolean;
}

interface PanelTabContentEntry {
  component: ComponentType<PanelTabContentProps>;
  options: Required<PanelContentOptions>;
}

interface PanelLauncherContentEntry {
  component: ComponentType<PanelLauncherContentProps>;
  options: Required<PanelContentOptions>;
}

const tabContents = new Map<PanelTabKind, PanelTabContentEntry>();
const launcherContents = new Map<PanelLauncherId, PanelLauncherContentEntry>();

function resolveOptions(
  options: PanelContentOptions | undefined,
): Required<PanelContentOptions> {
  return { retainWhenInactive: options?.retainWhenInactive ?? false };
}

/**
 * Register the component that renders tabs of `kind`. Call once at module
 * scope from the feature's `register.ts` (imported by
 * `src/screens/panel/contents/index.ts`); a later registration for the same
 * kind replaces the earlier one (the built-in placeholders register first).
 */
export function registerPanelTabContent<K extends PanelTabKind>(
  kind: K,
  component: ComponentType<PanelTabContentProps<PanelTabOfKind<K>>>,
  options?: PanelContentOptions,
): void {
  tabContents.set(kind, {
    // The registry is keyed by kind, so the narrowing the component declares
    // holds at the one place it is rendered (`getPanelTabContent` is only
    // called with a tab of that kind). The cast widens the props type back
    // to the registry's common shape.
    component: component as ComponentType<PanelTabContentProps>,
    options: resolveOptions(options),
  });
}

export function getPanelTabContent(
  kind: PanelTabKind,
): PanelTabContentEntry | null {
  return tabContents.get(kind) ?? null;
}

/** Register the Files (`"files"`) or Terminal (`"terminal"`) launcher page. */
export function registerPanelLauncherContent(
  launcher: PanelLauncherId,
  component: ComponentType<PanelLauncherContentProps>,
  options?: PanelContentOptions,
): void {
  launcherContents.set(launcher, {
    component,
    options: resolveOptions(options),
  });
}

export function getPanelLauncherContent(
  launcher: PanelLauncherId,
): PanelLauncherContentEntry | null {
  return launcherContents.get(launcher) ?? null;
}

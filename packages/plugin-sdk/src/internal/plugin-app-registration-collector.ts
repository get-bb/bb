import type { ComponentType } from "react";
import { z } from "zod";
import type {
  ExperimentalTabRegistration,
  ComposerCustomization,
  ExperimentalAppOverlayRegistration,
  ExperimentalCodeFenceRendererRegistration,
  ExperimentalSidebarFooter,
  ExperimentalSidebarFooterActionRegistration,
  ExperimentalSidebarFooterDisclosureController,
  ExperimentalSidebarFooterDisclosureRegistration,
  ExperimentalSidebarFooterItemRegistration,
  PluginAppDefinition,
  PluginContentScriptRegistration,
  PluginDiffRendererRegistration,
  ExperimentalComposerRegistration,
  PluginEnvironmentProviderInputsRegistration,
  PluginMachineProviderInputsRegistration,
  PluginFileOpenerRegistration,
  PluginHomepageSectionRegistration,
  PluginCommandRegistration,
  ExperimentalComposerCommandRegistration,
  PluginMessageActionRegistration,
  PluginMessageDirectiveRegistration,
  PluginNavPanelRegistration,
  PluginNewThreadPanelActionRegistration,
  PluginPendingInteractionRegistration,
  PluginProviderIconRegistration,
  ExperimentalIconRegistration,
  PluginSettingsSectionRegistration,
  PluginSidebarFooterActionRegistration,
  PluginSourceCodeRendererRegistration,
  ExperimentalThreadContextSegmentRegistration,
  ExperimentalThreadInfoRowRegistration,
  ExperimentalThreadInfoSectionRegistration,
  PluginThreadActionRegistration,
  ExperimentalPluginBrowserToolbarActionRegistration,
  ExperimentalSidebarHeaderProps,
  ExperimentalSidebarNavigationPlacement,
  ExperimentalSidebarNavigationRegistration,
  PluginThreadListRegistration,
  PluginTimelineRendererRegistration,
} from "@get-bb/plugin-sdk";
import {
  collectComposerCustomization,
  PLUGIN_SLOT_ID_PATTERN,
  requireComponent,
  requireEnvironmentProviderId,
  requireMessageDirectiveId,
  requireNonEmptyString,
  requireOptionalString,
  requireProviderId,
  requireSlotId,
  requireTimelineRendererKind,
  requireUniqueId,
} from "./composer-customization-validation.js";
import {
  type CollectedExperimentalSidebarFooterItem,
  type CollectedManagedSidebarFooterItem,
  type CollectedSidebarFooterItem,
  adaptSidebarFooterAction,
  SidebarFooterItemRuntime,
  sidebarFooterItemsByRegistrationSet,
} from "./sidebar-footer-runtime.js";
const CODE_FENCE_LANGUAGE_PATTERN = /^[a-z0-9][a-z0-9+#._-]*$/;

const SIDEBAR_FOOTER_ACTION_KEYS: ReadonlySet<string> = new Set([
  "id",
  "label",
  "icon",
  "kind",
  "onActivate",
]);

const SIDEBAR_FOOTER_DISCLOSURE_KEYS: ReadonlySet<string> = new Set([
  "id",
  "label",
  "icon",
  "kind",
  "component",
]);

class SidebarFooterCollector implements ExperimentalSidebarFooter {
  constructor(
    private readonly collected: CollectedExperimentalSidebarFooterItem[],
    private readonly allCollected: CollectedSidebarFooterItem[],
    private readonly seenIds: Set<string>,
  ) {}

  register(registration: ExperimentalSidebarFooterActionRegistration): void;
  register(
    registration: ExperimentalSidebarFooterDisclosureRegistration,
  ): ExperimentalSidebarFooterDisclosureController;
  register(
    registration: ExperimentalSidebarFooterItemRegistration,
  ): void | ExperimentalSidebarFooterDisclosureController {
    const kind = "experimental_sidebarFooter.register";
    const id = requireSlotId(kind, registration?.id);
    requireUniqueId(kind, this.seenIds, id);
    const label = requireNonEmptyString(kind, "label", registration.label);
    const icon = requireNonEmptyString(kind, "icon", registration.icon);
    const runtime = new SidebarFooterItemRuntime();

    if (registration.kind === "action") {
      this.rejectUnknownKeys(kind, registration, SIDEBAR_FOOTER_ACTION_KEYS);
      if (typeof registration.onActivate !== "function") {
        throw new Error(`${kind}: "onActivate" must be a function`);
      }
      const item: CollectedManagedSidebarFooterItem = {
        id,
        label,
        icon,
        kind: "action",
        onActivate: registration.onActivate,
        source: "experimental_sidebarFooter",
        runtime,
      };
      this.collected.push(item);
      this.allCollected.push(item);
      return;
    }

    if (registration.kind === "disclosure") {
      this.rejectUnknownKeys(
        kind,
        registration,
        SIDEBAR_FOOTER_DISCLOSURE_KEYS,
      );
      const item: CollectedManagedSidebarFooterItem = {
        id,
        label,
        icon,
        kind: "disclosure",
        component: requireComponent(kind, registration.component),
        source: "experimental_sidebarFooter",
        runtime,
      };
      this.collected.push(item);
      this.allCollected.push(item);
      return runtime.createDisclosureController();
    }

    throw new Error(`${kind}: "kind" must be "action" or "disclosure"`);
  }

  private rejectUnknownKeys(
    kind: string,
    registration: ExperimentalSidebarFooterItemRegistration,
    allowed: ReadonlySet<string>,
  ): void {
    for (const key of Object.keys(registration)) {
      if (!allowed.has(key)) throw new Error(`${kind}: unknown field "${key}"`);
    }
  }
}

export interface LegacyThreadPanelActionRegistration {
  id: string;
  title: string;
  icon?: string;
  component: ComponentType<
    import("@get-bb/plugin-sdk").ExperimentalThreadActionTabProps
  >;
  layout?: "padded" | "flush";
  run?(
    context: import("@get-bb/plugin-sdk").ExperimentalThreadTabActionContext,
  ): void | Promise<void>;
}

export interface LegacyThreadHeaderActionProps {
  threadId: string;
  projectId: string;
  isCompactViewport: boolean;
}

export interface LegacyThreadHeaderActionRegistration {
  id: string;
  title: string;
  component: ComponentType<LegacyThreadHeaderActionProps>;
}

export type LegacyNavPanelRegistration = PluginNavPanelRegistration & {
  fixedTabs?: readonly PluginNavPanelFixedTabRegistration[];
};

type PluginNavPanelFixedTabRegistration = {
  id: string;
  panelId: string;
  title: string;
  icon: string;
  component: ComponentType<import("@get-bb/plugin-sdk").PluginNavPanelProps>;
  layout?: "padded" | "flush";
  experimental_target?: import("@get-bb/plugin-sdk").ExperimentalFixedTabTargetContract<
    import("@get-bb/plugin-sdk").JsonValue
  >;
};

const NAV_PANEL_REGISTRATION_KEYS = {
  id: true,
  title: true,
  icon: true,
  path: true,
  component: true,
  fixedTabs: true,
  experimental_useBadge: true,
  experimental_usePageTitle: true,
  experimental_sidebar: true,
  headerContent: true,
} satisfies Record<keyof PluginNavPanelRegistration | "fixedTabs", true>;

const RENAMED_NAV_PANEL_KEYS: ReadonlyMap<string, string> = new Map([
  ["experimental_fixedTabs", 'was renamed to "fixedTabs" in SDK 0.4.16'],
]);

const RETIRED_NAV_PANEL_KEYS: ReadonlyMap<string, string> = new Map([
  [
    "experimental_sidebarAccessory",
    'is ignored: it was replaced by "experimental_useBadge", a hook returning a badge value, in SDK 0.6.53',
  ],
]);

function checkStaleNavPanelKeys(
  kind: string,
  registration: object,
  onWarning: (message: string) => void,
): void {
  for (const key of Object.keys(registration)) {
    if (Object.hasOwn(NAV_PANEL_REGISTRATION_KEYS, key)) continue;
    const renamed = RENAMED_NAV_PANEL_KEYS.get(key);
    if (renamed !== undefined) {
      throw new Error(`${kind}: "${key}" ${renamed}`);
    }
    const retired = RETIRED_NAV_PANEL_KEYS.get(key);
    if (retired !== undefined) {
      onWarning(`${kind}: "${key}" ${retired}`);
      continue;
    }
    if (key.startsWith("experimental_")) {
      throw new Error(`${kind}: unknown field "${key}"`);
    }
  }
}

export type CollectedPluginProviderIconRegistration = Omit<
  PluginProviderIconRegistration,
  "providerKind"
> & {
  providerKind: PluginProviderIconRegistration["providerKind"] | "all";
};

function createCommandShortcutSchema() {
  return z
    .object({
      key: z
        .string()
        .min(1)
        .max(32)
        .refine(
          (key) =>
            ![
              "Alt",
              "Control",
              "Meta",
              "OS",
              "Shift",
              "Dead",
              "Unidentified",
            ].includes(key),
        ),
      mod: z.boolean().default(false),
      meta: z.boolean().default(false),
      control: z.boolean().default(false),
      alt: z.boolean().default(false),
      shift: z.boolean().default(false),
    })
    .strict()
    .refine(
      (shortcut) =>
        shortcut.mod ||
        shortcut.meta ||
        shortcut.control ||
        shortcut.alt ||
        /^F(?:[1-9]|1[0-9]|2[0-4])$/u.test(shortcut.key),
      "Use Command, Control, or Alt with a key, or a function key",
    );
}

type CollectedCommandShortcut = z.infer<
  ReturnType<typeof createCommandShortcutSchema>
> | null;

export type CollectedPluginCommandRegistration =
  | (Omit<PluginCommandRegistration, "defaultShortcut"> & {
      target: "app";
      defaultShortcut: CollectedCommandShortcut;
    })
  | (Omit<ExperimentalComposerCommandRegistration, "defaultShortcut"> & {
      target: "composer";
      defaultShortcut: CollectedCommandShortcut;
    });

export interface CollectedPluginAppRegistrations {
  homepageSections: PluginHomepageSectionRegistration[];
  settingsSections: PluginSettingsSectionRegistration[];
  appOverlays: ExperimentalAppOverlayRegistration[];
  navPanels: LegacyNavPanelRegistration[];
  tabs: ExperimentalTabRegistration[];
  threadPanelActions: LegacyThreadPanelActionRegistration[];
  newThreadPanelActions: PluginNewThreadPanelActionRegistration[];
  composerCustomizations: ComposerCustomization[];
  pendingInteractions: PluginPendingInteractionRegistration[];
  sidebarFooterActions: PluginSidebarFooterActionRegistration[];
  experimentalSidebarFooterItems: CollectedExperimentalSidebarFooterItem[];
  threadLists: PluginThreadListRegistration[];
  experimentalSidebarNavigations: CollectedSidebarNavigationRegistration[];
  threadHeaderActions: LegacyThreadHeaderActionRegistration[];
  threadContextSegments: ExperimentalThreadContextSegmentRegistration[];
  threadInfoRows: ExperimentalThreadInfoRowRegistration[];
  threadInfoSections: ExperimentalThreadInfoSectionRegistration[];
  threadActions: PluginThreadActionRegistration<unknown>[];
  browserToolbarActions: ExperimentalPluginBrowserToolbarActionRegistration[];
  fileOpeners: PluginFileOpenerRegistration[];
  sourceCodeRenderers: PluginSourceCodeRendererRegistration[];
  diffRenderers: PluginDiffRendererRegistration[];
  composers: ExperimentalComposerRegistration[];
  messageDirectives: PluginMessageDirectiveRegistration[];
  codeFenceRenderers: ExperimentalCodeFenceRendererRegistration[];
  messageActions: PluginMessageActionRegistration[];
  commandPaletteActions: CollectedPluginCommandRegistration[];
  providerIcons: CollectedPluginProviderIconRegistration[];
  icons: ExperimentalIconRegistration[];
  timelineRenderers: PluginTimelineRendererRegistration[];
  environmentProviderInputs: PluginEnvironmentProviderInputsRegistration[];
  machineProviderInputs: PluginMachineProviderInputsRegistration[];
  contentScripts: PluginContentScriptRegistration[];
}

export interface CollectedSidebarNavigationRegistration extends ExperimentalSidebarNavigationRegistration {
  placement: ExperimentalSidebarNavigationPlacement;
}

function requireOptionalOrder(
  kind: string,
  order: number | undefined,
): { order?: number } {
  if (order === undefined) return {};
  if (!Number.isFinite(order)) {
    throw new Error(`${kind}: "order" must be a finite number`);
  }
  return { order };
}

function collectTitledComponent<C>(
  kind: string,
  seen: Set<string>,
  registration: {
    id: string;
    title: string;
    description?: string;
    component: C;
  },
): { id: string; title: string; description?: string; component: C } {
  const id = requireSlotId(kind, registration?.id);
  requireUniqueId(kind, seen, id);
  const description = requireOptionalString(
    kind,
    "description",
    registration.description,
  );
  return {
    id,
    title: requireNonEmptyString(kind, "title", registration.title),
    ...(description !== undefined ? { description } : {}),
    component: requireComponent<C>(kind, registration.component),
  };
}

function collectPanelAction<C, Run>(
  kind: string,
  seen: Set<string>,
  registration: {
    id: string;
    title: string;
    icon?: string;
    component: C;
    layout?: "padded" | "flush";
    run?: Run;
  },
): {
  id: string;
  title: string;
  icon?: string;
  component: C;
  layout?: "padded" | "flush";
  run?: Run;
} {
  const id = requireSlotId(kind, registration?.id);
  requireUniqueId(kind, seen, id);
  if (
    registration.run !== undefined &&
    typeof registration.run !== "function"
  ) {
    throw new Error(`${kind}: "run" must be a function when set`);
  }
  if (
    registration.layout !== undefined &&
    registration.layout !== "padded" &&
    registration.layout !== "flush"
  ) {
    throw new Error(`${kind}: "layout" must be "padded" or "flush"`);
  }
  return {
    id,
    title: requireNonEmptyString(kind, "title", registration.title),
    ...(registration.icon !== undefined
      ? { icon: requireNonEmptyString(kind, "icon", registration.icon) }
      : {}),
    component: requireComponent<C>(kind, registration.component),
    ...(registration.layout !== undefined
      ? { layout: registration.layout }
      : {}),
    ...(registration.run !== undefined ? { run: registration.run } : {}),
  };
}

export function collectPluginAppRegistrations(
  definition: PluginAppDefinition,
  onWarning: (message: string) => void = (message) => console.warn(message),
): CollectedPluginAppRegistrations {
  const commandShortcutSchema = createCommandShortcutSchema();
  const sidebarFooterItems: CollectedSidebarFooterItem[] = [];
  const collected: CollectedPluginAppRegistrations = {
    homepageSections: [],
    settingsSections: [],
    appOverlays: [],
    navPanels: [],
    tabs: [],
    get threadPanelActions() {
      return this.tabs.filter(
        (
          tab,
        ): tab is Extract<
          ExperimentalTabRegistration,
          { context: { kind: "thread" }; availability: "action" }
        > => tab.context.kind === "thread" && tab.availability === "action",
      );
    },
    newThreadPanelActions: [],
    composerCustomizations: [],
    pendingInteractions: [],
    sidebarFooterActions: [],
    experimentalSidebarFooterItems: [],
    threadLists: [],
    experimentalSidebarNavigations: [],
    threadHeaderActions: [],
    threadContextSegments: [],
    threadInfoRows: [],
    threadInfoSections: [],
    threadActions: [],
    browserToolbarActions: [],
    fileOpeners: [],
    sourceCodeRenderers: [],
    diffRenderers: [],
    composers: [],
    messageDirectives: [],
    codeFenceRenderers: [],
    messageActions: [],
    commandPaletteActions: [],
    providerIcons: [],
    icons: [],
    timelineRenderers: [],
    environmentProviderInputs: [],
    machineProviderInputs: [],
    contentScripts: [],
  };
  sidebarFooterItemsByRegistrationSet.set(collected, sidebarFooterItems);
  const seenIds = {
    homepageSection: new Set<string>(),
    settingsSection: new Set<string>(),
    appOverlay: new Set<string>(),
    navPanel: new Set<string>(),
    tab: new Set<string>(),
    newThreadPanelAction: new Set<string>(),
    composerCustomization: new Set<string>(),
    composerPopup: new Set<string>(),
    pendingInteraction: new Set<string>(),
    sidebarFooterItem: new Set<string>(),
    threadList: new Set<string>(),
    sidebarNavigation: new Set<string>(),
    sidebarHeader: new Set<string>(),
    threadHeaderAction: new Set<string>(),
    threadContextSegment: new Set<string>(),
    threadInfoRow: new Set<string>(),
    threadInfoSection: new Set<string>(),
    threadAction: new Set<string>(),
    browserToolbarAction: new Set<string>(),
    fileOpener: new Set<string>(),
    sourceCodeRenderer: new Set<string>(),
    diffRenderer: new Set<string>(),
    composer: new Set<string>(),
    messageDirective: new Set<string>(),
    codeFenceRenderer: new Set<string>(),
    codeFenceLanguage: new Set<string>(),
    messageAction: new Set<string>(),
    command: new Set<string>(),
    providerIcon: new Set<string>(),
    timelineRenderer: new Set<string>(),
    environmentProviderInputs: new Set<string>(),
    machineProviderInputs: new Set<string>(),
    contentScript: new Set<string>(),
  };

  function collectTab(value: unknown, legacy = false): void {
    const registration = value as ExperimentalTabRegistration;
    const kind = "slots.experimental_tab";
    const id = requireSlotId(kind, registration?.id);
    const context = registration.context;
    if (context?.kind !== "thread" && context?.kind !== "nav-panel") {
      throw new Error(`${kind}: context must be thread or nav-panel`);
    }
    if (context.kind === "nav-panel") requireSlotId(kind, context.panelId);
    const availability = registration.availability;
    if (availability !== "fixed" && availability !== "action") {
      throw new Error(`${kind}: availability must be fixed or action`);
    }
    requireUniqueId(
      kind,
      seenIds.tab,
      `${context.kind}/${context.kind === "nav-panel" ? context.panelId : ""}/${id}`,
    );
    if (
      registration.useVisible !== undefined &&
      typeof registration.useVisible !== "function"
    ) {
      throw new Error(`${kind}: useVisible must be a function`);
    }
    if (
      availability === "fixed" &&
      (registration.run !== undefined || registration.params !== undefined)
    ) {
      throw new Error(`${kind}: run and params require action availability`);
    }
    const target = registration.experimental_target;
    if (
      target !== undefined &&
      (availability !== "fixed" || typeof target?.validate !== "function")
    ) {
      throw new Error(
        `${kind}: experimental_target requires a fixed tab and a validate function`,
      );
    }
    const validated = {
      ...registration,
      ...collectPanelAction<
        ExperimentalTabRegistration["component"],
        ExperimentalTabRegistration["run"]
      >(kind, new Set(), {
        ...registration,
        icon:
          legacy && registration.icon === "" ? undefined : registration.icon,
      }),
      icon:
        legacy && registration.icon === ""
          ? ""
          : requireNonEmptyString(kind, "icon", registration.icon),
      ...(registration.tooltip === undefined
        ? {}
        : {
            tooltip: requireNonEmptyString(
              kind,
              "tooltip",
              registration.tooltip,
            ),
          }),
      ...(availability === "action" && registration.params !== undefined
        ? { params: z.json().parse(registration.params) }
        : {}),
    };
    collected.tabs.push(validated as ExperimentalTabRegistration);
  }

  function collectCommand(
    kind: string,
    registration:
      | PluginCommandRegistration
      | ExperimentalComposerCommandRegistration,
  ) {
    const id = requireSlotId(kind, registration?.id);
    requireUniqueId(kind, seenIds.command, id);
    if (typeof registration.run !== "function") {
      throw new Error(`${kind}: "run" must be a function`);
    }
    return {
      id,
      defaultShortcut:
        registration.defaultShortcut === undefined
          ? null
          : commandShortcutSchema.parse(registration.defaultShortcut),
      title: requireNonEmptyString(kind, "title", registration.title),
    };
  }

  function registerCommand(registration: PluginCommandRegistration): void {
    const kind = "commands.register";
    const command = collectCommand(kind, registration);
    if (
      registration.isAvailable !== undefined &&
      typeof registration.isAvailable !== "function"
    ) {
      throw new Error(`${kind}: "isAvailable" must be a function`);
    }
    collected.commandPaletteActions.push({
      target: "app",
      ...command,
      ...(registration.isAvailable !== undefined
        ? { isAvailable: registration.isAvailable }
        : {}),
      run: registration.run,
    });
  }

  function registerComposerCommand(
    registration: ExperimentalComposerCommandRegistration,
  ): void {
    collected.commandPaletteActions.push({
      target: "composer",
      ...collectCommand("composer.experimental_registerCommand", registration),
      run: registration.run,
    });
  }

  const legacySidebarHeaders: ComponentType<ExperimentalSidebarHeaderProps>[] =
    [];
  const legacySlotAliases = {
    threadPanelAction(registration: LegacyThreadPanelActionRegistration) {
      try {
        const action = collectPanelAction(
          "slots.threadPanelAction",
          new Set(),
          registration,
        );
        collectTab(
          {
            ...action,
            icon: action.icon ?? "",
            context: { kind: "thread" },
            availability: "action",
          },
          true,
        );
      } catch (error) {
        onWarning(`Legacy threadPanelAction ignored: ${String(error)}`);
      }
    },

    experimental_threadHeaderAction(
      registration: LegacyThreadHeaderActionRegistration,
    ) {
      const kind = "slots.experimental_threadHeaderAction";
      const id = requireSlotId(kind, registration?.id);
      requireUniqueId(kind, seenIds.threadHeaderAction, id);
      collected.threadHeaderActions.push({
        id,
        title: requireNonEmptyString(kind, "title", registration.title),
        component: requireComponent(kind, registration.component),
      });
    },

    experimental_sidebarHeader(registration: LegacySidebarHeaderRegistration) {
      legacySidebarHeaders.push(
        collectTitledComponent(
          "slots.experimental_sidebarHeader",
          seenIds.sidebarHeader,
          registration,
        ).component,
      );
    },
  };

  definition.setup({
    commands: { register: registerCommand },
    slots: {
      ...legacySlotAliases,
      homepageSection(registration) {
        const kind = "slots.homepageSection";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.homepageSection, id);
        collected.homepageSections.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          component: requireComponent(kind, registration.component),
        });
      },
      settingsSection(registration) {
        const kind = "slots.settingsSection";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.settingsSection, id);
        const title = requireOptionalString(kind, "title", registration.title);
        const description = requireOptionalString(
          kind,
          "description",
          registration.description,
        );
        const page = registration.experimental_page;
        if (page !== undefined && page !== "mobile") {
          throw new Error(`${kind}: experimental_page must be "mobile"`);
        }
        collected.settingsSections.push({
          ...(page !== undefined ? { experimental_page: page } : {}),
          id,
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          component: requireComponent(kind, registration.component),
        });
      },
      experimental_appOverlay(registration) {
        const kind = "slots.experimental_appOverlay";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.appOverlay, id);
        collected.appOverlays.push({
          id,
          component: requireComponent(kind, registration.component),
        });
      },
      navPanel(registration) {
        const kind = "slots.navPanel";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.navPanel, id);
        checkStaleNavPanelKeys(kind, registration, onWarning);
        const panelId = id;
        const path = requireNonEmptyString(kind, "path", registration.path);
        if (!PLUGIN_SLOT_ID_PATTERN.test(path)) {
          throw new Error(
            `${kind}: "path" must match ${String(PLUGIN_SLOT_ID_PATTERN)} (it becomes a URL segment), got ${JSON.stringify(path)}`,
          );
        }
        if (
          registration.headerContent !== undefined &&
          typeof registration.headerContent !== "function"
        ) {
          throw new Error(
            `${kind}: "headerContent" must be a React component function when set`,
          );
        }
        if (
          registration.experimental_useBadge !== undefined &&
          typeof registration.experimental_useBadge !== "function"
        ) {
          throw new Error(
            `${kind}: "experimental_useBadge" must be a React hook function when set`,
          );
        }
        if (
          registration.experimental_sidebar !== undefined &&
          typeof registration.experimental_sidebar !== "function"
        ) {
          throw new Error(
            `${kind}: "experimental_sidebar" must be a React component function when set`,
          );
        }
        if (
          registration.experimental_usePageTitle !== undefined &&
          typeof registration.experimental_usePageTitle !== "function"
        ) {
          throw new Error(
            `${kind}: "experimental_usePageTitle" must be a React hook function when set`,
          );
        }
        const legacy = registration as PluginNavPanelRegistration & {
          fixedTabs?: readonly PluginNavPanelFixedTabRegistration[];
        };
        const fixedTabs: PluginNavPanelFixedTabRegistration[] = [];
        if (
          legacy.fixedTabs !== undefined &&
          !Array.isArray(legacy.fixedTabs)
        ) {
          onWarning("Legacy navPanel.fixedTabs ignored: expected an array");
        }
        for (const value of Array.isArray(legacy.fixedTabs)
          ? legacy.fixedTabs
          : []) {
          try {
            const id = requireSlotId(kind, value?.id);
            const tab: PluginNavPanelFixedTabRegistration = {
              id,
              panelId,
              title: requireNonEmptyString(kind, "title", value.title ?? id),
              icon: typeof value.icon === "string" ? value.icon : "",
              component: requireComponent(kind, value.component),
              ...(value.layout === "flush" ? { layout: "flush" } : {}),
              ...(typeof value.experimental_target?.validate === "function"
                ? { experimental_target: value.experimental_target }
                : {}),
            };
            collectTab(
              {
                ...tab,
                context: { kind: "nav-panel", panelId },
                availability: "fixed",
              },
              true,
            );
            fixedTabs.push(tab);
          } catch (error) {
            onWarning(
              `Legacy navPanel.fixedTabs entry ignored: ${String(error)}`,
            );
          }
        }
        collected.navPanels.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          icon: requireNonEmptyString(kind, "icon", registration.icon),
          path,
          ...(fixedTabs.length === 0 ? {} : { fixedTabs }),
          component: requireComponent(kind, registration.component),
          ...(registration.experimental_useBadge !== undefined
            ? {
                experimental_useBadge: registration.experimental_useBadge,
              }
            : {}),
          ...(registration.experimental_usePageTitle !== undefined
            ? {
                experimental_usePageTitle:
                  registration.experimental_usePageTitle,
              }
            : {}),
          ...(registration.experimental_sidebar !== undefined
            ? { experimental_sidebar: registration.experimental_sidebar }
            : {}),
          ...(registration.headerContent !== undefined
            ? { headerContent: registration.headerContent }
            : {}),
        });
      },
      experimental_tab(registration: unknown) {
        collectTab(registration);
      },
      experimental_newThreadPanelAction(registration) {
        collected.newThreadPanelActions.push(
          collectPanelAction(
            "slots.experimental_newThreadPanelAction",
            seenIds.newThreadPanelAction,
            registration,
          ),
        );
      },
      pendingInteraction(registration) {
        const kind = "slots.pendingInteraction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.pendingInteraction, id);
        collected.pendingInteractions.push({
          id,
          component: requireComponent(kind, registration.component),
        });
      },
      sidebarFooterAction(registration) {
        const kind = "slots.sidebarFooterAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.sidebarFooterItem, id);
        if (typeof registration.run !== "function") {
          throw new Error(`${kind}: "run" must be a function`);
        }
        const legacyRegistration = {
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          icon: requireNonEmptyString(kind, "icon", registration.icon),
          run: registration.run,
        };
        collected.sidebarFooterActions.push(legacyRegistration);
        sidebarFooterItems.push(adaptSidebarFooterAction(legacyRegistration));
      },
      experimental_threadList(registration) {
        collected.threadLists.push(
          collectTitledComponent(
            "slots.experimental_threadList",
            seenIds.threadList,
            registration,
          ),
        );
      },
      experimental_sidebarNavigation(registration) {
        const kind = "slots.experimental_sidebarNavigation";
        const collectedRegistration = collectTitledComponent(
          kind,
          seenIds.sidebarNavigation,
          registration,
        );
        const placement = registration.placement;
        if (
          placement !== undefined &&
          placement !== "rail" &&
          placement !== "list"
        ) {
          throw new Error(`${kind}: "placement" must be "rail" or "list"`);
        }
        const headerComponent = registration.headerComponent;
        if (
          headerComponent !== undefined &&
          typeof headerComponent !== "function"
        ) {
          throw new Error(
            `${kind}: "headerComponent" must be a React component function`,
          );
        }
        collected.experimentalSidebarNavigations.push({
          ...collectedRegistration,
          placement: placement ?? "list",
          ...(headerComponent !== undefined ? { headerComponent } : {}),
        });
      },
      experimental_threadContextSegment(registration) {
        const kind = "slots.experimental_threadContextSegment";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.threadContextSegment, id);
        const optionalComponent = (field: "action" | "details") => {
          const value = registration[field];
          if (value === undefined) return {};
          if (typeof value !== "function") {
            throw new Error(
              `${kind}: "${field}" must be a React component function`,
            );
          }
          return { [field]: value };
        };
        if (typeof registration.summary !== "function") {
          throw new Error(
            `${kind}: "summary" must be a React component function`,
          );
        }
        if (
          registration.useVisible !== undefined &&
          typeof registration.useVisible !== "function"
        ) {
          throw new Error(`${kind}: "useVisible" must be a function`);
        }
        collected.threadContextSegments.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          group: requireNonEmptyString(kind, "group", registration.group),
          ...requireOptionalOrder(kind, registration.order),
          summary: registration.summary,
          ...optionalComponent("action"),
          ...optionalComponent("details"),
          ...(registration.useVisible !== undefined
            ? { useVisible: registration.useVisible }
            : {}),
        });
      },
      experimental_threadInfoRow(registration) {
        const kind = "slots.experimental_threadInfoRow";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.threadInfoRow, id);
        collected.threadInfoRows.push({
          id,
          group: requireNonEmptyString(kind, "group", registration.group),
          ...requireOptionalOrder(kind, registration.order),
          component: requireComponent(kind, registration.component),
        });
      },
      experimental_threadInfoSection(registration) {
        const kind = "slots.experimental_threadInfoSection";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.threadInfoSection, id);
        collected.threadInfoSections.push({
          id,
          group: requireNonEmptyString(kind, "group", registration.group),
          ...requireOptionalOrder(kind, registration.order),
          component: requireComponent(kind, registration.component),
        });
      },
      experimental_threadAction(registration) {
        const kind = "slots.experimental_threadAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.threadAction, id);
        if (typeof registration.item !== "function") {
          throw new Error(`${kind}: "item" must be a function`);
        }
        if (
          registration.useData !== undefined &&
          typeof registration.useData !== "function"
        ) {
          throw new Error(`${kind}: "useData" must be a function`);
        }
        if (
          registration.experimental_bulkItem !== undefined &&
          typeof registration.experimental_bulkItem !== "function"
        ) {
          throw new Error(
            `${kind}: "experimental_bulkItem" must be a function`,
          );
        }
        if (
          registration.placement !== undefined &&
          registration.placement !== "menu" &&
          registration.placement !== "header"
        ) {
          throw new Error(`${kind}: "placement" must be "menu" or "header"`);
        }
        collected.threadActions.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          icon: requireNonEmptyString(kind, "icon", registration.icon),
          group: requireNonEmptyString(kind, "group", registration.group),
          ...requireOptionalOrder(kind, registration.order),
          ...(registration.placement !== undefined
            ? { placement: registration.placement }
            : {}),
          ...(registration.useData !== undefined
            ? { useData: registration.useData }
            : {}),
          item: registration.item,
          ...(registration.experimental_bulkItem !== undefined
            ? {
                experimental_bulkItem: registration.experimental_bulkItem,
              }
            : {}),
        });
      },
      experimental_browserToolbarAction(registration) {
        const kind = "slots.experimental_browserToolbarAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.browserToolbarAction, id);
        collected.browserToolbarActions.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          component: requireComponent(kind, registration.component),
        });
      },
      fileOpener(registration) {
        const kind = "slots.fileOpener";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.fileOpener, id);
        const rawExtensions = registration?.extensions;
        if (!Array.isArray(rawExtensions) || rawExtensions.length === 0) {
          throw new Error(
            `${kind}: "extensions" must be a non-empty array of lowercase extensions without the dot`,
          );
        }
        const extensions = rawExtensions.map((extension) => {
          if (
            typeof extension !== "string" ||
            !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(extension)
          ) {
            throw new Error(
              `${kind}: extensions must be lowercase alphanumerics with single underscores or hyphens between segments, without the dot, got ${JSON.stringify(extension)}`,
            );
          }
          return extension;
        });
        collected.fileOpeners.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          extensions,
          component: requireComponent(kind, registration.component),
        });
      },
      experimental_sourceCodeRenderer(registration) {
        collected.sourceCodeRenderers.push(
          collectTitledComponent(
            "slots.experimental_sourceCodeRenderer",
            seenIds.sourceCodeRenderer,
            registration,
          ),
        );
      },
      experimental_diffRenderer(registration) {
        collected.diffRenderers.push(
          collectTitledComponent(
            "slots.experimental_diffRenderer",
            seenIds.diffRenderer,
            registration,
          ),
        );
      },
      experimental_composer(registration) {
        collected.composers.push(
          collectTitledComponent(
            "slots.experimental_composer",
            seenIds.composer,
            registration,
          ),
        );
      },
      messageDirective(registration) {
        const kind = "slots.messageDirective";
        const id = requireMessageDirectiveId(kind, registration?.id);
        requireUniqueId(kind, seenIds.messageDirective, id);
        collected.messageDirectives.push({
          id,
          component: requireComponent(kind, registration.component),
        });
      },
      experimental_codeFenceRenderer(registration) {
        const kind = "slots.experimental_codeFenceRenderer";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.codeFenceRenderer, id);
        const rawLanguages: unknown = registration.languages;
        if (!Array.isArray(rawLanguages) || rawLanguages.length === 0) {
          throw new Error(
            `${kind}: "languages" must be a non-empty array of lowercase info-string languages`,
          );
        }
        const languages = rawLanguages.map((language: unknown) => {
          if (
            typeof language !== "string" ||
            !CODE_FENCE_LANGUAGE_PATTERN.test(language)
          ) {
            throw new Error(
              `${kind}: languages must match ${CODE_FENCE_LANGUAGE_PATTERN}, got ${JSON.stringify(language)}`,
            );
          }
          if (seenIds.codeFenceLanguage.has(language)) {
            throw new Error(`${kind}: duplicate language "${language}"`);
          }
          seenIds.codeFenceLanguage.add(language);
          return language;
        });
        collected.codeFenceRenderers.push({
          id,
          languages,
          component: requireComponent(kind, registration.component),
        });
      },
      messageAction(registration) {
        const kind = "slots.messageAction";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.messageAction, id);
        if (typeof registration.run !== "function") {
          throw new Error(`${kind}: "run" must be a function`);
        }
        collected.messageActions.push({
          id,
          title: requireNonEmptyString(kind, "title", registration.title),
          ...(registration.icon !== undefined
            ? {
                icon: requireNonEmptyString(kind, "icon", registration.icon),
              }
            : {}),
          run: registration.run,
        });
      },
      commandPaletteAction(registration) {
        registerCommand(registration);
      },
      experimental_providerIcon(registration) {
        const kind = "slots.experimental_providerIcon";
        const providerId = requireProviderId(kind, registration?.providerId);
        const declaredKind = registration.providerKind;
        if (
          declaredKind !== undefined &&
          declaredKind !== "agent" &&
          declaredKind !== "machine" &&
          declaredKind !== "environment"
        ) {
          throw new Error(`${kind}: invalid providerKind`);
        }
        const providerKind = declaredKind ?? "all";
        requireUniqueId(
          kind,
          seenIds.providerIcon,
          `${providerKind}:${providerId}`,
        );
        collected.providerIcons.push({
          providerKind,
          providerId,
          icon: requireComponent(kind, registration.icon),
        });
      },
      experimental_timelineRenderer(registration) {
        const kind = "slots.experimental_timelineRenderer";
        const itemKind = requireTimelineRendererKind(kind, registration?.kind);
        requireUniqueId(kind, seenIds.timelineRenderer, itemKind);
        collected.timelineRenderers.push({
          kind: itemKind,
          component: requireComponent(kind, registration.component),
        });
      },
      experimental_environmentProviderInputs(registration) {
        const kind = "slots.experimental_environmentProviderInputs";
        const environmentProviderId = requireEnvironmentProviderId(
          kind,
          registration?.environmentProviderId,
        );
        requireUniqueId(
          kind,
          seenIds.environmentProviderInputs,
          environmentProviderId,
        );
        collected.environmentProviderInputs.push({
          environmentProviderId,
          component: requireComponent(kind, registration.component),
        });
      },
      experimental_machineProviderInputs(registration) {
        const kind = "slots.experimental_machineProviderInputs";
        const machineProviderId = requireProviderId(
          kind,
          registration?.machineProviderId,
        );
        requireUniqueId(kind, seenIds.machineProviderInputs, machineProviderId);
        collected.machineProviderInputs.push({
          machineProviderId,
          component: requireComponent(kind, registration.component),
        });
      },
    },
    experimental_sidebarFooter: new SidebarFooterCollector(
      collected.experimentalSidebarFooterItems,
      sidebarFooterItems,
      seenIds.sidebarFooterItem,
    ),
    composer: {
      customize(registration) {
        const customization = collectComposerCustomization(
          registration,
          seenIds.composerCustomization,
          (reason) => onWarning(`composer customization rejected: ${reason}`),
          seenIds.composerPopup,
        );
        if (customization !== null) {
          collected.composerCustomizations.push(customization);
        }
      },
      experimental_registerCommand: registerComposerCommand,
    },
    experimental_icons: {
      register(registration) {
        const kind = "experimental_icons.register";
        const name = requireNonEmptyString(
          kind,
          "name",
          registration?.name,
        ).trim();
        if (name.length === 0)
          throw new Error(`${kind}: "name" must not be blank`);
        if (collected.icons.some((icon) => icon.name === name)) {
          throw new Error(`${kind}: duplicate icon name "${name}"`);
        }
        collected.icons.push({
          name,
          component: requireComponent(kind, registration.component),
        });
      },
    },
    contentScripts: {
      register(registration) {
        const kind = "contentScripts.register";
        const id = requireSlotId(kind, registration?.id);
        requireUniqueId(kind, seenIds.contentScript, id);
        if (typeof registration.mount !== "function") {
          throw new Error(`${kind}: "mount" must be a function`);
        }
        collected.contentScripts.push({ id, mount: registration.mount });
      },
    },
  });

  attachLegacySidebarHeaders(
    collected.experimentalSidebarNavigations,
    legacySidebarHeaders,
    onWarning,
  );
  return collected;
}

interface LegacySidebarHeaderRegistration {
  id: string;
  title: string;
  description?: string;
  component: ComponentType<ExperimentalSidebarHeaderProps>;
}

function attachLegacySidebarHeaders(
  navigations: CollectedSidebarNavigationRegistration[],
  headers: readonly ComponentType<ExperimentalSidebarHeaderProps>[],
  onWarning: (message: string) => void,
): void {
  const [header, ...extraHeaders] = headers;
  if (header === undefined) return;
  const kind = "slots.experimental_sidebarHeader";
  if (extraHeaders.length > 0) {
    onWarning(
      `${kind}: only the first header is used; pass "headerComponent" to each experimental_sidebarNavigation instead`,
    );
  }
  let attached = false;
  navigations.forEach((navigation, index) => {
    if (navigation.headerComponent !== undefined) return;
    navigations[index] = { ...navigation, headerComponent: header };
    attached = true;
  });
  if (!attached) {
    onWarning(
      `${kind}: ignored because the plugin registers no navigation without a "headerComponent"`,
    );
  }
}
